import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  CODEX_APP_SERVER_COMMAND,
  CODEX_BINARY_NAME,
  CODEX_CLIENT_ABORTED_MESSAGE,
  CODEX_CONFIG_FILE_NAME,
  CODEX_EXITED_MESSAGE,
  CODEX_HOME_DIR_NAME,
  CODEX_HOME_ENV_VAR,
  CODEX_HOME_REMOVAL_FAILED_MESSAGE,
  CODEX_LOG_PREFIX,
  CODEX_MCP_TOKEN_ENV_VAR,
  CODEX_ORPHAN_POLL_MS,
  CODEX_PID_REGISTRY_FILE,
  CODEX_PID_RELEASE_FAILED_MESSAGE,
  CODEX_PID_TOKEN,
  CODEX_PROC_CMDLINE,
  CODEX_SPAWN_FAILED_MESSAGE,
  CODEX_STDERR_TAIL_BYTES,
  CODEX_STRICT_CONFIG_FLAG,
  CODEX_SURVIVED_STOP_MESSAGE,
  PROCESS_QUERY_BY_PLATFORM,
} from "../../constants/codex.js";
import { PLATFORM_LINUX } from "../../constants/native-binary.js";
import { safeDirSegment } from "../../state/safe-segment.js";
import type { CodexClient, CodexClientHandlers } from "./client.js";
import { createCodexClient } from "./client.js";
import {
  CHATGPT_TOKEN_SECRET_ENV,
  CHATGPT_TOKEN_URL_ENV,
} from "../../constants/chatgpt.js";
import { ACCESS_TOKEN_SECRET } from "./chatgpt/http.js";
import { buildConfigToml } from "./config.js";
import type { CodexInstallation } from "./resolve-binary.js";
import {
  isWindowsHost,
  runStopSteps,
  type StopGraces,
  type StoppedWithin,
  sweepProcessTree,
} from "./stop.js";

export interface CodexProcessOptions {
  conversationId: string;
  stateDir: string;
  installation: CodexInstallation;
  mcpUrl: string;
  mcpToken: string;
  hostProjectRoot: string;
  /** The sidecar route the app-server's auth command reads its token from. */
  accessTokenUrl: string;
  handlers: CodexClientHandlers;
  /** How long each stop step waits for the app-server to exit. */
  stopGraces?: StopGraces;
}

export interface CodexProcess {
  client: CodexClient;
  codexHome: string;
  pid: number | undefined;
  /**
   * Stops the app-server and removes its home, in that order: resolves once the
   * process has exited and its files are gone. Never rejects.
   */
  dispose: () => Promise<void>;
}

/**
 * The isolated home for one conversation. The id is reduced to a safe segment
 * because this directory is removed recursively, twice: a raw id would let the
 * client choose what gets deleted.
 */
export function codexHomeFor(stateDir: string, conversationId: string): string {
  return path.join(
    stateDir,
    CODEX_HOME_DIR_NAME,
    safeDirSegment(conversationId),
  );
}

function pidRegistryPath(stateDir: string): string {
  return path.join(stateDir, CODEX_PID_REGISTRY_FILE);
}

/** One app-server a sidecar started, with the home it was given. */
interface PidRecord {
  pid: number;
  home: string;
}

const pidRecordSchema = z.object({ pid: z.number().int(), home: z.string() });

const pidRegistrySchema = z.array(z.unknown());

async function readPidRegistry(stateDir: string): Promise<PidRecord[]> {
  try {
    const raw = await readFile(pidRegistryPath(stateDir), "utf8");
    const entries = pidRegistrySchema.safeParse(JSON.parse(raw));
    if (!entries.success) return [];
    return entries.data.flatMap((entry) => {
      const record = pidRecordSchema.safeParse(entry);
      return record.success ? [record.data] : [];
    });
  } catch {
    return [];
  }
}

async function writePidRegistry(
  stateDir: string,
  records: readonly PidRecord[],
): Promise<void> {
  mkdirSync(stateDir, { recursive: true });
  await writeFile(pidRegistryPath(stateDir), JSON.stringify([...records]));
}

function readProcCmdline(pid: number): string | undefined {
  return readFileSync(
    CODEX_PROC_CMDLINE.replace(CODEX_PID_TOKEN, String(pid)),
    "utf8",
  );
}

function queryProcessTable(pid: number): string | undefined {
  const [command, ...args] = PROCESS_QUERY_BY_PLATFORM[process.platform] ?? [];
  if (command === undefined) return undefined;
  return execFileSync(
    command,
    args.map((arg) => arg.replace(CODEX_PID_TOKEN, String(pid))),
    { encoding: "utf8", windowsHide: true },
  );
}

/**
 * The command line of a running process, or undefined when it is gone or
 * unreadable. Never throws: an unreadable process is treated as absent. Reads
 * procfs where there is one, the platform's own process table elsewhere: Linux
 * is not the only host, and a macOS or Windows sidecar that cannot read a
 * command line would never recognize an orphan, and would therefore never reap
 * one.
 */
export function readProcessCommand(pid: number): string | undefined {
  const read =
    process.platform === PLATFORM_LINUX ? readProcCmdline : queryProcessTable;
  try {
    const command = read(pid)?.trim();
    return command === undefined || command.length === 0 ? undefined : command;
  } catch {
    return undefined;
  }
}

/**
 * A recorded pid may have been recycled by an unrelated process, so the command
 * line is checked before signalling anything. Windows reports the image name
 * (`codex.exe`), which carries the binary name just the same.
 */
export function isCodexProcess(pid: number): boolean {
  return readProcessCommand(pid)?.includes(CODEX_BINARY_NAME) === true;
}

function waitUnref(waitMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, waitMs).unref());
}

function orphanGoneWithin(pid: number): StoppedWithin {
  return async (waitMs) => {
    const deadline = Date.now() + waitMs;
    while (isCodexProcess(pid)) {
      if (Date.now() >= deadline) return false;
      await waitUnref(CODEX_ORPHAN_POLL_MS);
    }
    return true;
  };
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function exitsWithin(child: ChildProcess, waitMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, waitMs);
    child.once("exit", onExit);
  });
}

async function stopChild(
  child: ChildProcess,
  pid: number,
  graces: StopGraces | undefined,
): Promise<boolean> {
  if (hasExited(child)) return true;
  return runStopSteps(pid, (waitMs) => exitsWithin(child, waitMs), graces);
}

interface ReapOutcome {
  record: PidRecord;
  isStopped: boolean;
}

async function stopOrphan(
  record: PidRecord,
  graces: StopGraces | undefined,
): Promise<ReapOutcome> {
  const isStopped = await runStopSteps(
    record.pid,
    orphanGoneWithin(record.pid),
    graces,
  );
  return { record, isStopped };
}

/** Removes every home under `<state>/codex-home/` but the survivors'. */
async function removeOrphanHomes(
  stateDir: string,
  survivors: readonly PidRecord[],
): Promise<void> {
  const kept = new Set(survivors.map((record) => record.home));
  const homesRoot = path.join(stateDir, CODEX_HOME_DIR_NAME);
  const entries = await readdir(homesRoot).catch((): string[] => []);
  const orphanHomes = entries
    .map((entry) => path.join(homesRoot, entry))
    .filter((home) => !kept.has(home));
  await Promise.all(orphanHomes.map(removeHome));
}

async function forgetReaped(
  stateDir: string,
  recorded: readonly PidRecord[],
  survivors: readonly PidRecord[],
): Promise<void> {
  if (recorded.length === 0) return;
  const survivorPids = new Set(survivors.map((record) => record.pid));
  const settled = new Set(
    recorded
      .map((record) => record.pid)
      .filter((pid) => !survivorPids.has(pid)),
  );
  await updateRegistry(stateDir, (current) =>
    current.filter((record) => !settled.has(record.pid)),
  );
}

/**
 * Kills app-server processes left behind by a previous sidecar that did not exit
 * cleanly, then removes the homes they left: each holds the client's code. Resolves once both are done. A process that outlives its
 * termination stays recorded, and keeps its home, for the next start.
 */
export async function reapOrphanCodexProcesses(
  stateDir: string,
  graces?: StopGraces,
): Promise<number[]> {
  const recorded = await readPidRegistry(stateDir);
  const orphans = recorded.filter((record) => isCodexProcess(record.pid));
  const outcomes = await Promise.all(
    orphans.map((record) => stopOrphan(record, graces)),
  );
  const survivors = outcomes
    .filter((outcome) => !outcome.isStopped)
    .map((outcome) => outcome.record);
  await forgetReaped(stateDir, recorded, survivors);
  await removeOrphanHomes(stateDir, survivors);
  const killed = orphans.map((record) => record.pid);
  if (killed.length > 0) {
    console.warn(
      `${CODEX_LOG_PREFIX} reaped orphan processes: ${killed.join(", ")}`,
    );
  }
  return killed;
}

/**
 * Read-modify-write on a shared file: two conversations disposed at the same
 * time would otherwise each write back a list computed before the other's
 * change, dropping a pid that is still running — the very orphan the registry
 * exists to catch.
 */
let registryQueue: Promise<unknown> = Promise.resolve();

function updateRegistry(
  stateDir: string,
  mutate: (recorded: readonly PidRecord[]) => PidRecord[],
): Promise<void> {
  const next = registryQueue.then(async () => {
    const recorded = await readPidRegistry(stateDir);
    await writePidRegistry(stateDir, mutate(recorded));
  });
  registryQueue = next.catch(() => undefined);
  return next;
}

function recordPid(stateDir: string, pid: number, home: string): Promise<void> {
  return updateRegistry(stateDir, (recorded) => [
    ...recorded.filter((record) => record.pid !== pid),
    { pid, home },
  ]);
}

function forgetPid(stateDir: string, pid: number): Promise<void> {
  return updateRegistry(stateDir, (recorded) =>
    recorded.filter((record) => record.pid !== pid),
  );
}

const releasingHomes = new Map<string, Promise<void>>();

function trackRelease(codexHome: string, release: Promise<void>): void {
  releasingHomes.set(codexHome, release);
  void release.then(() => {
    if (releasingHomes.get(codexHome) === release) {
      releasingHomes.delete(codexHome);
    }
  });
}

async function prepareCodexHome(options: CodexProcessOptions): Promise<string> {
  const codexHome = codexHomeFor(options.stateDir, options.conversationId);
  await releasingHomes.get(codexHome);
  await rm(codexHome, { recursive: true, force: true });
  mkdirSync(codexHome, { recursive: true });
  await writeFile(
    path.join(codexHome, CODEX_CONFIG_FILE_NAME),
    buildConfigToml({
      mcpUrl: options.mcpUrl,
      hostProjectRoot: options.hostProjectRoot,
      nodePath: process.execPath,
    }),
  );
  return codexHome;
}

function spawnChild(
  options: CodexProcessOptions,
  codexHome: string,
): ChildProcess {
  return spawn(
    options.installation.binaryPath,
    [
      ...options.installation.launchArgs,
      CODEX_APP_SERVER_COMMAND,
      CODEX_STRICT_CONFIG_FLAG,
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      detached: !isWindowsHost(),
      env: {
        ...process.env,
        [CODEX_HOME_ENV_VAR]: codexHome,
        [CODEX_MCP_TOKEN_ENV_VAR]: options.mcpToken,
        [CHATGPT_TOKEN_URL_ENV]: options.accessTokenUrl,
        [CHATGPT_TOKEN_SECRET_ENV]: ACCESS_TOKEN_SECRET,
      },
    },
  );
}

interface StderrTail {
  read: () => string;
}

/**
 * Drained whatever happens: an unread stderr pipe fills at 64 KiB and blocks
 * the child itself. What it said is kept, bounded, because it is the only
 * account of why a binary that died on startup did so.
 */
function drainStderr(child: ChildProcess): StderrTail {
  let tail = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    tail = `${tail}${chunk}`.slice(-CODEX_STDERR_TAIL_BYTES);
  });
  return { read: () => tail.trim() };
}

function describeExit(code: number | null, signal: string | null): string {
  const cause = signal === null ? `code ${String(code)}` : `signal ${signal}`;
  return `${CODEX_EXITED_MESSAGE} (${cause})`;
}

interface Watchdog {
  /** Runs on the child's death, unless the session already disposed of it. */
  arm: (client: CodexClient) => void;
  markDisposed: () => void;
}

/**
 * Turns the child's death into a failed request. `spawn` reports a missing or
 * unusable binary through an `error` event with no listener — which takes the
 * whole sidecar down — and an exit settles nothing at all, leaving the
 * handshake awaiting an answer no one will send.
 */
function watchChild(child: ChildProcess, stderr: StderrTail): Watchdog {
  let pendingReason: Error | null = null;
  let disposed = false;
  let target: CodexClient | null = null;

  function fail(message: string): void {
    if (disposed) return;
    const detail = stderr.read();
    const reason = new Error(detail === "" ? message : `${message}: ${detail}`);
    console.error(`${CODEX_LOG_PREFIX} ${reason.message}`);
    if (target === null) {
      pendingReason = reason;
      return;
    }
    target.abort(reason);
  }

  child.on("error", (error) =>
    fail(`${CODEX_SPAWN_FAILED_MESSAGE}: ${error.message}`),
  );
  child.on("exit", (code, signal) => fail(describeExit(code, signal)));

  return {
    arm: (client) => {
      target = client;
      if (pendingReason !== null) client.abort(pendingReason);
    },
    markDisposed: () => {
      disposed = true;
    },
  };
}

async function retireChild(
  stateDir: string,
  child: ChildProcess,
  graces: StopGraces | undefined,
): Promise<boolean> {
  const { pid } = child;
  if (pid === undefined) return true;
  if (!(await stopChild(child, pid, graces))) {
    console.warn(`${CODEX_LOG_PREFIX} ${CODEX_SURVIVED_STOP_MESSAGE} ${pid}`);
    return false;
  }
  try {
    await forgetPid(stateDir, pid);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `${CODEX_LOG_PREFIX} ${CODEX_PID_RELEASE_FAILED_MESSAGE} ${pid}: ${reason}`,
    );
  }
  return true;
}

/**
 * The whole home goes, not just sessions/: a fresh home already carries state,
 * logs, memories, goals and queue databases, all of which end up holding the
 * client's code.
 */
async function removeHome(codexHome: string): Promise<void> {
  try {
    await rm(codexHome, { recursive: true, force: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `${CODEX_LOG_PREFIX} ${CODEX_HOME_REMOVAL_FAILED_MESSAGE} ${codexHome}: ${reason}`,
    );
  }
}

interface ProcessTeardown {
  stateDir: string;
  codexHome: string;
  client: CodexClient;
  watchdog: Watchdog;
  child: ChildProcess;
  graces: StopGraces | undefined;
}

async function disposeProcess(teardown: ProcessTeardown): Promise<void> {
  teardown.watchdog.markDisposed();
  teardown.client.abort(
    new Error(`${CODEX_LOG_PREFIX} ${CODEX_CLIENT_ABORTED_MESSAGE}`),
  );
  if (await retireChild(teardown.stateDir, teardown.child, teardown.graces)) {
    await removeHome(teardown.codexHome);
  }
}

/**
 * A crashed app-server leaves its group behind as surely as a stopped one: what
 * it started is killed as soon as it exits, whatever the cause.
 */
function sweepOnExit(child: ChildProcess): void {
  const { pid } = child;
  if (pid === undefined) return;
  child.once("exit", () => sweepProcessTree(pid));
}

function buildCodexProcess(teardown: ProcessTeardown): CodexProcess {
  let disposal: Promise<void> | null = null;
  return {
    client: teardown.client,
    codexHome: teardown.codexHome,
    pid: teardown.child.pid,
    dispose: () => {
      if (disposal !== null) return disposal;
      disposal = disposeProcess(teardown);
      trackRelease(teardown.codexHome, disposal);
      return disposal;
    },
  };
}

async function registerPid(
  stateDir: string,
  spawned: CodexProcess,
): Promise<void> {
  if (spawned.pid === undefined) return;
  try {
    await recordPid(stateDir, spawned.pid, spawned.codexHome);
  } catch (error) {
    await spawned.dispose();
    throw error;
  }
}

/**
 * Spawns the app-server and wires its lifecycle. The watchdog and the stderr
 * drain are attached before any `await` and before the pipe check, because a
 * spawn failure is reported on the next tick and an unhandled `error` event is
 * fatal.
 */
export async function spawnCodexProcess(
  options: CodexProcessOptions,
): Promise<CodexProcess> {
  const codexHome = await prepareCodexHome(options);
  const child = spawnChild(options, codexHome);
  const watchdog = watchChild(child, drainStderr(child));
  sweepOnExit(child);
  if (child.stdin === null || child.stdout === null) {
    throw new Error(`${CODEX_LOG_PREFIX} failed to open app-server pipes`);
  }
  const client = createCodexClient(child.stdin, child.stdout, options.handlers);
  watchdog.arm(client);
  const spawned = buildCodexProcess({
    stateDir: options.stateDir,
    codexHome,
    client,
    watchdog,
    child,
    graces: options.stopGraces,
  });
  await registerPid(options.stateDir, spawned);
  return spawned;
}
