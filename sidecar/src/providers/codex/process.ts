import { type ChildProcess, spawn } from "node:child_process";
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
  CODEX_LOG_PREFIX,
  CODEX_MCP_TOKEN_ENV_VAR,
  CODEX_PID_REGISTRY_FILE,
  CODEX_PROC_CMDLINE,
  CODEX_SPAWN_FAILED_MESSAGE,
  CODEX_STDERR_TAIL_BYTES,
  CODEX_STRICT_CONFIG_FLAG,
  CODEX_TERMINATE_GRACE_MS,
} from "../../constants/codex.js";
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
  dispose: () => Promise<void>;
}

function codexHomeFor(stateDir: string, conversationId: string): string {
  return path.join(stateDir, CODEX_HOME_DIR_NAME, conversationId);
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

// A recorded pid may have been recycled by an unrelated process, so the command
// line is checked before signalling anything.
function isCodexProcess(pid: number): boolean {
  try {
    const cmdline = readFileSync(
      CODEX_PROC_CMDLINE.replace("%pid%", String(pid)),
      "utf8",
    );
    return cmdline.includes(CODEX_BINARY_NAME);
  } catch {
    return false;
  }
}

function terminate(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  setTimeout(() => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }, CODEX_TERMINATE_GRACE_MS).unref();
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

async function prepareCodexHome(options: CodexProcessOptions): Promise<string> {
  const codexHome = codexHomeFor(options.stateDir, options.conversationId);
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
    [CODEX_APP_SERVER_COMMAND, CODEX_STRICT_CONFIG_FLAG],
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

  let disposed = false;
  return {
    client,
    codexHome,
    pid,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      watchdog.markDisposed();
      client.abort(
        new Error(`${CODEX_LOG_PREFIX} ${CODEX_CLIENT_ABORTED_MESSAGE}`),
      );
      if (pid !== undefined) {
        terminate(pid);
        await forgetPid(options.stateDir, pid);
      }
      // The whole home goes, not just sessions/: a fresh home already carries
      // state, logs, memories, goals and queue databases, all of which end up
      // holding the client's code.
      await rm(codexHome, { recursive: true, force: true });
    },
  };
}
