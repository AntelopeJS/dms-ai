import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CODEX_APP_SERVER_COMMAND,
  CODEX_AUTH_FILE_MODE,
  CODEX_AUTH_FILE_NAME,
  CODEX_BINARY_NAME,
  CODEX_CLIENT_ABORTED_MESSAGE,
  CODEX_CONFIG_FILE_NAME,
  CODEX_EXITED_MESSAGE,
  CODEX_HOME_DIR_NAME,
  CODEX_HOME_ENV_VAR,
  CODEX_HOME_REMOVAL_FAILED_MESSAGE,
  CODEX_KILL_GRACE_MS,
  CODEX_LOG_PREFIX,
  CODEX_MCP_TOKEN_ENV_VAR,
  CODEX_PID_REGISTRY_FILE,
  CODEX_PID_RELEASE_FAILED_MESSAGE,
  CODEX_PID_TOKEN,
  CODEX_PROC_CMDLINE,
  CODEX_SPAWN_FAILED_MESSAGE,
  CODEX_STDERR_TAIL_BYTES,
  CODEX_STRICT_CONFIG_FLAG,
  CODEX_SURVIVED_STOP_MESSAGE,
  CODEX_TERMINATE_GRACE_MS,
  PROCESS_QUERY_BY_PLATFORM,
  WINDOWS_PLATFORM,
  WINDOWS_TREE_KILL,
} from "../../constants/codex.js";
import { safeDirSegment } from "../../state/safe-segment.js";
import type { CodexClient, CodexClientHandlers } from "./client.js";
import { createCodexClient } from "./client.js";
import { buildAuthFile, buildConfigToml } from "./config.js";
import type { CodexInstallation } from "./resolve-binary.js";

export interface CodexProcessOptions {
  conversationId: string;
  stateDir: string;
  installation: CodexInstallation;
  mcpUrl: string;
  mcpToken: string;
  hostProjectRoot: string;
  apiKey: string;
  handlers: CodexClientHandlers;
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
 * client choose what gets deleted, and what the auth file lands next to.
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

async function readPidRegistry(stateDir: string): Promise<number[]> {
  try {
    const raw = await readFile(pidRegistryPath(stateDir), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
}

async function writePidRegistry(
  stateDir: string,
  pids: readonly number[],
): Promise<void> {
  mkdirSync(stateDir, { recursive: true });
  await writeFile(pidRegistryPath(stateDir), JSON.stringify([...pids]));
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

// procfs where there is one, the platform's own process table elsewhere. Linux
// is not the only host: a macOS or Windows sidecar that cannot read a command
// line would never recognize an orphan, and would therefore never reap one.
const COMMAND_READERS: Record<string, (pid: number) => string | undefined> = {
  linux: readProcCmdline,
};

/**
 * The command line of a running process, or undefined when it is gone or
 * unreadable. Never throws: an unreadable process is treated as absent.
 */
export function readProcessCommand(pid: number): string | undefined {
  const read = COMMAND_READERS[process.platform] ?? queryProcessTable;
  try {
    const command = read(pid)?.trim();
    return command === undefined || command.length === 0 ? undefined : command;
  } catch {
    return undefined;
  }
}

// A recorded pid may have been recycled by an unrelated process, so the command
// line is checked before signalling anything. Windows reports the image name
// (`codex.exe`), which carries the binary name just the same.
export function isCodexProcess(pid: number): boolean {
  return readProcessCommand(pid)?.includes(CODEX_BINARY_NAME) === true;
}

// Windows has no signals: `process.kill` terminates the app-server and leaves
// whatever it spawned behind, so the tree is killed through taskkill instead.
function terminateWindows(pid: number): void {
  const [command, ...args] = WINDOWS_TREE_KILL;
  try {
    execFileSync(
      command,
      args.map((arg) => arg.replace(CODEX_PID_TOKEN, String(pid))),
      { windowsHide: true, stdio: "ignore" },
    );
  } catch {
    // Already gone, or never ours to kill.
  }
}

function sendSignal(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone.
  }
}

function terminatePosix(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  setTimeout(
    () => sendSignal(pid, "SIGKILL"),
    CODEX_TERMINATE_GRACE_MS,
  ).unref();
}

function terminate(pid: number): void {
  const kill =
    process.platform === WINDOWS_PLATFORM ? terminateWindows : terminatePosix;
  kill(pid);
}

interface StopStep {
  send: (pid: number) => void;
  /** How long the child is given to exit after this step. */
  waitMs: number;
}

// The tree kill is already forceful on Windows, so there is nothing to
// escalate to there.
const POSIX_STOP_STEPS: readonly StopStep[] = [
  {
    send: (pid) => sendSignal(pid, "SIGTERM"),
    waitMs: CODEX_TERMINATE_GRACE_MS,
  },
  { send: (pid) => sendSignal(pid, "SIGKILL"), waitMs: CODEX_KILL_GRACE_MS },
];
const WINDOWS_STOP_STEPS: readonly StopStep[] = [
  { send: terminateWindows, waitMs: CODEX_KILL_GRACE_MS },
];

// Node records how a child ended right after reaping it, which is also when its
// pid becomes free for the system to hand out again.
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

/**
 * Stops a child this sidecar spawned and waits for its exit, which a bare
 * signal does not: until then it can still write into its home. A child that
 * is already gone is not signalled at all: its pid may belong to another
 * process by now. False when it outlived every step.
 */
async function stopChild(child: ChildProcess, pid: number): Promise<boolean> {
  const steps =
    process.platform === WINDOWS_PLATFORM
      ? WINDOWS_STOP_STEPS
      : POSIX_STOP_STEPS;
  for (const step of steps) {
    if (hasExited(child)) return true;
    step.send(pid);
    if (await exitsWithin(child, step.waitMs)) return true;
  }
  return false;
}

/**
 * Kills app-server processes left behind by a previous sidecar that did not exit
 * cleanly. Each holds a model connection and writes to disk, so orphans are not
 * harmless.
 */
export async function reapOrphanCodexProcesses(
  stateDir: string,
): Promise<number[]> {
  const recorded = await readPidRegistry(stateDir);
  if (recorded.length === 0) return [];
  const killed = recorded.filter(isCodexProcess);
  for (const pid of killed) terminate(pid);
  await updateRegistry(stateDir, () => []);
  if (killed.length > 0) {
    console.warn(
      `${CODEX_LOG_PREFIX} reaped orphan processes: ${killed.join(", ")}`,
    );
  }
  return killed;
}

// Read-modify-write on a shared file: two conversations disposed at the same
// time would otherwise each write back a list computed before the other's
// change, dropping a pid that is still running — the very orphan the registry
// exists to catch.
let registryQueue: Promise<unknown> = Promise.resolve();

function updateRegistry(
  stateDir: string,
  mutate: (recorded: readonly number[]) => number[],
): Promise<void> {
  const next = registryQueue.then(async () => {
    const recorded = await readPidRegistry(stateDir);
    await writePidRegistry(stateDir, mutate(recorded));
  });
  registryQueue = next.catch(() => undefined);
  return next;
}

function recordPid(stateDir: string, pid: number): Promise<void> {
  return updateRegistry(stateDir, (recorded) => [
    ...new Set([...recorded, pid]),
  ]);
}

function forgetPid(stateDir: string, pid: number): Promise<void> {
  return updateRegistry(stateDir, (recorded) =>
    recorded.filter((candidate) => candidate !== pid),
  );
}

// A conversation keeps the same home path from one process to the next, and a
// teardown only removes that home once its process has exited. Reopened in
// the meantime, the conversation would have its fresh home removed under it,
// so a home is only prepared again once the previous teardown has let go.
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
    }),
  );
  await writeFile(
    path.join(codexHome, CODEX_AUTH_FILE_NAME),
    JSON.stringify(buildAuthFile(options.apiKey)),
    { mode: CODEX_AUTH_FILE_MODE },
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
      env: {
        ...process.env,
        [CODEX_HOME_ENV_VAR]: codexHome,
        [CODEX_MCP_TOKEN_ENV_VAR]: options.mcpToken,
      },
    },
  );
}

interface StderrTail {
  read: () => string;
}

// Drained whatever happens: an unread stderr pipe fills at 64 KiB and blocks
// the child itself. What it said is kept, bounded, because it is the only
// account of why a binary that died on startup did so.
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Forgotten only once it is gone: a pid dropped while the process still runs is
// an orphan the next start can no longer find.
async function retireChild(
  stateDir: string,
  child: ChildProcess,
): Promise<void> {
  const { pid } = child;
  if (pid === undefined) return;
  if (!(await stopChild(child, pid))) {
    console.warn(`${CODEX_LOG_PREFIX} ${CODEX_SURVIVED_STOP_MESSAGE} ${pid}`);
    return;
  }
  await forgetPid(stateDir, pid).catch((error: unknown) => {
    console.warn(
      `${CODEX_LOG_PREFIX} ${CODEX_PID_RELEASE_FAILED_MESSAGE} ${pid}: ${describeError(error)}`,
    );
  });
}

// The whole home goes, not just sessions/: a fresh home already carries state,
// logs, memories, goals and queue databases, all of which end up holding the
// client's code.
async function removeHome(codexHome: string): Promise<void> {
  await rm(codexHome, { recursive: true, force: true }).catch(
    (error: unknown) => {
      console.error(
        `${CODEX_LOG_PREFIX} ${CODEX_HOME_REMOVAL_FAILED_MESSAGE} ${codexHome}: ${describeError(error)}`,
      );
    },
  );
}

interface ProcessTeardown {
  stateDir: string;
  codexHome: string;
  client: CodexClient;
  watchdog: Watchdog;
  child: ChildProcess;
}

// In this order because the home is only safe to remove once nothing writes to
// it any more. Never rejects: the callers are teardown paths with nothing
// better to do with a failure than to report it, which happens here.
async function disposeProcess(teardown: ProcessTeardown): Promise<void> {
  teardown.watchdog.markDisposed();
  teardown.client.abort(
    new Error(`${CODEX_LOG_PREFIX} ${CODEX_CLIENT_ABORTED_MESSAGE}`),
  );
  await retireChild(teardown.stateDir, teardown.child);
  await removeHome(teardown.codexHome);
}

export async function spawnCodexProcess(
  options: CodexProcessOptions,
): Promise<CodexProcess> {
  const codexHome = await prepareCodexHome(options);
  const child = spawnChild(options, codexHome);
  // Both before any `await` and before the pipe check below: a spawn failure is
  // reported on the next tick, and an unhandled `error` event is fatal.
  const watchdog = watchChild(child, drainStderr(child));
  if (child.stdin === null || child.stdout === null) {
    throw new Error(`${CODEX_LOG_PREFIX} failed to open app-server pipes`);
  }
  const client = createCodexClient(child.stdin, child.stdout, options.handlers);
  watchdog.arm(client);
  const pid = child.pid;
  if (pid !== undefined) await recordPid(options.stateDir, pid);

  // Shared, so a second caller waits for the teardown already under way rather
  // than returning while the child still runs.
  let disposal: Promise<void> | null = null;
  return {
    client,
    codexHome,
    pid,
    dispose: () => {
      if (disposal !== null) return disposal;
      disposal = disposeProcess({
        stateDir: options.stateDir,
        codexHome,
        client,
        watchdog,
        child,
      });
      trackRelease(codexHome, disposal);
      return disposal;
    },
  };
}
