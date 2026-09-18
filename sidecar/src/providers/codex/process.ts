import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CODEX_APP_SERVER_COMMAND,
  CODEX_AUTH_FILE_MODE,
  CODEX_AUTH_FILE_NAME,
  CODEX_BINARY_NAME,
  CODEX_CONFIG_FILE_NAME,
  CODEX_HOME_DIR_NAME,
  CODEX_HOME_ENV_VAR,
  CODEX_LOG_PREFIX,
  CODEX_MCP_TOKEN_ENV_VAR,
  CODEX_PID_REGISTRY_FILE,
  CODEX_PROC_CMDLINE,
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

export async function spawnCodexProcess(
  options: CodexProcessOptions,
): Promise<CodexProcess> {
  const codexHome = await prepareCodexHome(options);
  const child = spawnChild(options, codexHome);
  if (child.stdin === null || child.stdout === null) {
    throw new Error(`${CODEX_LOG_PREFIX} failed to open app-server pipes`);
  }
  const client = createCodexClient(child.stdin, child.stdout, options.handlers);
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
      client.abort(new Error(`${CODEX_LOG_PREFIX} session disposed`));
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
