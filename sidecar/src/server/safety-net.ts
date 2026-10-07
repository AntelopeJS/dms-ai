import path from "node:path";
import {
  resolveModuleRootForFile,
  runTypecheck,
  type TypecheckResult,
} from "../agent/typecheck.js";
import {
  HOST_LOG_SETTLE_MS,
  LOG_LEVEL_ERROR,
  RELOAD_ERROR_CHANNELS,
} from "../constants/logs.js";
import {
  HEAL_MAX_LOG_LINES,
  HEAL_PROMPT_HOSTLOG_HEADING,
  HEAL_PROMPT_INTRO,
  HEAL_PROMPT_TYPECHECK_HEADING,
} from "../constants/safety-net.js";
import type { LogsClient } from "../logs/logs-client.js";
import type { BufferedLog } from "../logs/types.js";
import type { TypecheckOutcome } from "../constants/audit.js";

// A line worth listing in the auto-fix notice: a compiler error, or a reload
// log line (which the summary prefixes with its channel).
const ERROR_LINE = /error|^\[/i;

export function uniqueEditedRoots(
  editedFiles: readonly string[],
  knownRoots: readonly string[],
): string[] {
  const roots = new Set<string>();
  for (const file of editedFiles) {
    const root = resolveModuleRootForFile(file, knownRoots);
    if (root !== null) roots.add(root);
  }
  return [...roots];
}

function argToText(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg !== null && typeof arg === "object") {
    const candidate = arg as { message?: unknown; stack?: unknown };
    if (typeof candidate.stack === "string") return candidate.stack;
    if (typeof candidate.message === "string") return candidate.message;
    try {
      return JSON.stringify(arg);
    } catch {
      // A cycle, or a BigInt nested inside. `String(arg)` keeps a custom
      // `toString()` -- which an error object usually has, and which is the
      // whole content of the summary this feeds -- and only degrades to
      // "[object Object]" for a plain one.
      return String(arg);
    }
  }
  return String(arg);
}

export function summarizeReloadErrors(
  logs: readonly BufferedLog[],
): string | null {
  const relevant = logs.filter(
    (log) =>
      log.levelId >= LOG_LEVEL_ERROR &&
      RELOAD_ERROR_CHANNELS.includes(log.channel),
  );
  if (relevant.length === 0) return null;
  const lines = relevant
    .slice(0, HEAL_MAX_LOG_LINES)
    .map((log) => `[${log.channel}] ${log.args.map(argToText).join(" ")}`);
  return lines.join("\n");
}

export interface CollectIssuesDeps {
  editedFiles: string[];
  knownRoots: string[];
  logsClient: LogsClient;
  sinceMs: number;
  runTypecheckFn?: (targetRoot: string) => Promise<TypecheckResult>;
  delay?: (ms: number) => Promise<void>;
  settleMs?: number;
  logger?: Pick<Console, "warn">;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** What the safety net found after a turn that edited files. */
export interface BuildReport {
  // The auto-fix prompt, or null when the build is healthy.
  healPrompt: string | null;
  // `skipped` when no typecheck could run on the edited roots.
  typecheck: TypecheckOutcome;
  // One line per problem, for the auto-fix notice.
  errors: string[];
}

interface TypecheckPass {
  summaries: string[];
  typecheck: TypecheckOutcome;
}

async function typecheckRoots(deps: CollectIssuesDeps): Promise<TypecheckPass> {
  const runTs =
    deps.runTypecheckFn ?? ((root) => runTypecheck({ targetRoot: root }));
  const roots = uniqueEditedRoots(deps.editedFiles, deps.knownRoots);
  const summaries: string[] = [];
  let hasRun = false;
  for (const root of roots) {
    const result = await runTs(root);
    hasRun ||= result.ran;
    if (result.ran && !result.ok) {
      summaries.push(`${path.basename(root)}:\n${result.summary}`);
    }
  }
  const typecheck: TypecheckOutcome = !hasRun
    ? "skipped"
    : summaries.length > 0
      ? "failed"
      : "passed";
  return { summaries, typecheck };
}

function errorLines(summaries: string[], logSummary: string | null): string[] {
  const text = [...summaries, logSummary ?? ""].join("\n");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => ERROR_LINE.test(line))
    .slice(0, HEAL_MAX_LOG_LINES);
}

/** Typechecks the edited roots and reads the host's reload errors. */
export async function inspectBuild(
  deps: CollectIssuesDeps,
): Promise<BuildReport> {
  const { summaries, typecheck } = await typecheckRoots(deps);
  const delay = deps.delay ?? defaultDelay;
  await delay(deps.settleMs ?? HOST_LOG_SETTLE_MS);
  const logs = await deps.logsClient.getLogs({
    since: deps.sinceMs,
    level: LOG_LEVEL_ERROR,
  });
  const logSummary = summarizeReloadErrors(logs);
  if (summaries.length === 0 && logSummary === null) {
    return { healPrompt: null, typecheck, errors: [] };
  }
  return {
    healPrompt: buildHealPrompt(summaries, logSummary),
    typecheck,
    errors: errorLines(summaries, logSummary),
  };
}

export async function collectBuildIssues(
  deps: CollectIssuesDeps,
): Promise<string | null> {
  return (await inspectBuild(deps)).healPrompt;
}

function buildHealPrompt(
  tsSummaries: string[],
  logSummary: string | null,
): string {
  const sections: string[] = [HEAL_PROMPT_INTRO];
  if (tsSummaries.length > 0) {
    sections.push(
      `${HEAL_PROMPT_TYPECHECK_HEADING}\n${tsSummaries.join("\n\n")}`,
    );
  }
  if (logSummary !== null) {
    sections.push(`${HEAL_PROMPT_HOSTLOG_HEADING}\n${logSummary}`);
  }
  return sections.join("\n\n");
}
