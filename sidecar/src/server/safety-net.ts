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

export async function collectBuildIssues(
  deps: CollectIssuesDeps,
): Promise<string | null> {
  const runTs =
    deps.runTypecheckFn ?? ((root) => runTypecheck({ targetRoot: root }));
  const roots = uniqueEditedRoots(deps.editedFiles, deps.knownRoots);
  const tsSummaries: string[] = [];
  for (const root of roots) {
    const result = await runTs(root);
    if (result.ran && !result.ok) {
      tsSummaries.push(`${path.basename(root)}:\n${result.summary}`);
    }
  }
  const delay = deps.delay ?? defaultDelay;
  await delay(deps.settleMs ?? HOST_LOG_SETTLE_MS);
  const logs = await deps.logsClient.getLogs({
    since: deps.sinceMs,
    level: LOG_LEVEL_ERROR,
  });
  const logSummary = summarizeReloadErrors(logs);
  if (tsSummaries.length === 0 && logSummary === null) return null;
  return buildHealPrompt(tsSummaries, logSummary);
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
