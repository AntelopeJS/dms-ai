import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  TYPECHECK_ARGS,
  TYPECHECK_CLEAN_MESSAGE,
  TYPECHECK_COMMAND,
  TYPECHECK_ERROR_LINE_REGEX,
  TYPECHECK_ERRORS_PREFIX,
  TYPECHECK_LOG_PREFIX,
  TYPECHECK_MAX_BUFFER_BYTES,
  TYPECHECK_MAX_SUMMARY_LINES,
  TYPECHECK_NO_TSCONFIG_MESSAGE,
  TYPECHECK_TIMEOUT_MS,
  TYPECHECK_TSCONFIG_FILENAME,
  TYPECHECK_UNAVAILABLE_MESSAGE,
} from "../constants/typecheck.js";

const execFileAsync = promisify(execFile);

export interface ExecFailure {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  code?: number | string;
}

export type ExecFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export interface TypecheckResult {
  ran: boolean;
  ok: boolean;
  errorCount: number;
  summary: string;
}

export interface RunTypecheckOptions {
  targetRoot: string;
  timeoutMs?: number;
  exec?: ExecFn;
  logger?: Pick<Console, "warn">;
}

function toText(value: string | Buffer | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : value.toString("utf8");
}

export function parseTscOutput(output: string): {
  errorCount: number;
  summary: string;
} {
  const lines = output
    .split(/\r?\n/)
    .filter((line) => TYPECHECK_ERROR_LINE_REGEX.test(line))
    .map((line) => line.trim());
  if (lines.length === 0) return { errorCount: 0, summary: "" };
  const shown = lines.slice(0, TYPECHECK_MAX_SUMMARY_LINES);
  const omitted = lines.length - shown.length;
  const tail =
    omitted > 0
      ? `\n…and ${omitted} more error${omitted === 1 ? "" : "s"}.`
      : "";
  return {
    errorCount: lines.length,
    summary: `${TYPECHECK_ERRORS_PREFIX}\n${shown.join("\n")}${tail}`,
  };
}

function isExecFailure(err: unknown): err is ExecFailure {
  return typeof err === "object" && err !== null;
}

function skipped(summary: string): TypecheckResult {
  return { ran: false, ok: true, errorCount: 0, summary };
}

export async function runTypecheck(
  opts: RunTypecheckOptions,
): Promise<TypecheckResult> {
  const logger = opts.logger ?? console;
  const tsconfig = path.join(opts.targetRoot, TYPECHECK_TSCONFIG_FILENAME);
  if (!existsSync(tsconfig)) {
    logger.warn(
      `${TYPECHECK_LOG_PREFIX} no ${TYPECHECK_TSCONFIG_FILENAME} in ${opts.targetRoot}; skipping`,
    );
    return skipped(TYPECHECK_NO_TSCONFIG_MESSAGE);
  }
  const exec = opts.exec ?? (execFileAsync as ExecFn);
  try {
    await exec(TYPECHECK_COMMAND, TYPECHECK_ARGS, {
      cwd: opts.targetRoot,
      timeout: opts.timeoutMs ?? TYPECHECK_TIMEOUT_MS,
      maxBuffer: TYPECHECK_MAX_BUFFER_BYTES,
    });
    return {
      ran: true,
      ok: true,
      errorCount: 0,
      summary: TYPECHECK_CLEAN_MESSAGE,
    };
  } catch (err) {
    const failure: ExecFailure = isExecFailure(err) ? err : {};
    const output = `${toText(failure.stdout)}\n${toText(failure.stderr)}`;
    const { errorCount, summary } = parseTscOutput(output);
    if (errorCount === 0) {
      logger.warn(
        `${TYPECHECK_LOG_PREFIX} tsc did not run cleanly in ${opts.targetRoot}: ${toText(failure.stderr) || failure.code}`,
      );
      return skipped(TYPECHECK_UNAVAILABLE_MESSAGE);
    }
    return { ran: true, ok: false, errorCount, summary };
  }
}

function normalize(root: string): string {
  return path.resolve(root);
}

function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

export function resolveModuleRootForFile(
  filePath: string,
  knownRoots: readonly string[],
): string | null {
  const abs = path.resolve(filePath);
  let best: string | null = null;
  for (const root of knownRoots) {
    const r = normalize(root);
    if (!isWithin(r, abs)) continue;
    if (best === null || r.length > best.length) best = r;
  }
  return best;
}

export interface TargetResolution {
  root: string | null;
  knownTargets: string[];
}

function knownTargetLabels(knownRoots: readonly string[]): string[] {
  return knownRoots.map((r) => path.basename(normalize(r)));
}

export function resolveTypecheckTarget(
  target: string | undefined,
  knownRoots: readonly string[],
  lastEditedFile: string | undefined,
  hostProjectRoot: string,
): TargetResolution {
  const knownTargets = knownTargetLabels(knownRoots);
  if (target === undefined || target.length === 0) {
    if (lastEditedFile !== undefined) {
      const owner = resolveModuleRootForFile(lastEditedFile, knownRoots);
      if (owner !== null) return { root: owner, knownTargets };
    }
    return { root: normalize(hostProjectRoot), knownTargets };
  }
  const byName = knownRoots.find((r) => path.basename(normalize(r)) === target);
  if (byName !== undefined) return { root: normalize(byName), knownTargets };
  const owner = resolveModuleRootForFile(target, knownRoots);
  return { root: owner, knownTargets };
}
