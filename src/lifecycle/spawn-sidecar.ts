import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { Logging } from "@antelopejs/interface-core/logging";
import { PRODUCTION_NODE_ENV } from "../constants/module";
import {
  SIDECAR_BACKEND_URL_FLAG,
  SIDECAR_BIN_NAME,
  SIDECAR_BUILD_ID_FLAG,
  SIDECAR_BUILDER_FLAG,
  SIDECAR_CACHE_DIR_SEGMENTS,
  SIDECAR_DISABLED_FLAG,
  SIDECAR_DIST_REL,
  SIDECAR_ENV_DISABLE_KEY,
  SIDECAR_HEALTH_PATH,
  SIDECAR_HEALTH_TIMEOUT_MS,
  SIDECAR_LOCK_FILE_NAME,
  SIDECAR_LOCK_POLL_INTERVAL_MS,
  SIDECAR_LOG_FILE_NAME,
  SIDECAR_LOG_PREFIX,
  SIDECAR_LOOPBACK_HOST,
  SIDECAR_MODULE_ROOTS_FLAG,
  SIDECAR_SKILL_DIRS_FLAG,
  SIDECAR_SPAWN_TIMEOUT_MS,
  SIDECAR_STOP_TIMEOUT_MS,
} from "../constants/sidecar";
import { computeBuildId } from "./build-id";
import { getSidecarOwner, type SidecarLaunch } from "./sidecar-owner";
import type { SkillSource } from "./skill-sources";
import { terminateProcess } from "./terminate-process";

interface SpawnOptions {
  hostProjectRoot: string;
  // Origin the sidecar's registry, logs and builder clients call the backend
  // on. It comes from the module config; left out, the sidecar keeps its own
  // standalone default.
  backendUrl?: string;
  // Authoritative module roots (from interface-core) auto-allowed for read-only
  // tools. Captured in the launch so an idle-revive respawn reuses the same set.
  moduleRoots?: string[];
  // Skill sources contributed by loaded modules (`antelopeJs.skills`). Captured
  // in the launch so an idle-revive respawn reuses the same set.
  skillDirs?: SkillSource[];
  // Whether the dms-builder interface is provided, unlocking the sidecar's
  // safe-mode builder tools. Captured in the launch so a respawn keeps the same
  // mode.
  builderEnabled?: boolean;
}

interface SidecarLock {
  port: number;
  pid: number;
  version: string;
  buildId: string;
  startedAt: number;
  token?: string;
  clientToken?: string;
}

interface HealthResponse {
  ok?: boolean;
}

interface LauncherState {
  options: SpawnOptions | null;
}

const state: LauncherState = {
  options: null,
};

export function getSidecarPort(): number | null {
  return getSidecarOwner().getPort();
}

export function getSidecarToken(): string | null {
  const root = state.options?.hostProjectRoot ?? process.cwd();
  return readLock(root)?.token ?? null;
}

/** Returns the client credential without exposing the backend service token. */
export function getSidecarClientToken(): string | null {
  const root = state.options?.hostProjectRoot ?? process.cwd();
  return readLock(root)?.clientToken ?? null;
}

export function isSidecarRunning(): boolean {
  return getSidecarPort() !== null;
}

// True once the crash budget is spent: the sidecar is deliberately down and a
// probe can no longer revive it, so the client should stop waiting and warn.
export function hasSidecarGivenUp(): boolean {
  return getSidecarOwner().hasGivenUp();
}

// True when spawning is turned off for this process (production or the disable
// env flag); the client uses it to skip injecting the assistant entirely rather
// than show a perpetually-reconnecting icon.
export function isSidecarDisabled(): boolean {
  return mustSkipSpawn();
}

// The sidecar is a child of this process, owned process-wide so a hot reload of
// the module keeps it running; the core stops it with the project's other child
// processes on shutdown.
export async function spawnSidecar(opts: SpawnOptions): Promise<void> {
  state.options = opts;
  if (mustSkipSpawn()) return;
  await getSidecarOwner().attach(createLaunch(opts));
}

// Idempotent revive: brings the sidecar back if it has idle-exited (or never
// started), and is a no-op while one is already running or being spawned.
// Called on every /ai/sidecar-info probe so navigation transparently respawns
// the daemon after its idle shutdown. Stays a no-op once the crash budget is
// exhausted, so probe traffic can't re-arm a sidecar that has deliberately
// given up — recovery then requires a restart/reload.
export async function ensureSidecarRunning(): Promise<void> {
  if (mustSkipSpawn()) return;
  await getSidecarOwner().revive();
}

function mustSkipSpawn(): boolean {
  if (process.env.NODE_ENV === PRODUCTION_NODE_ENV) return true;
  if (process.env[SIDECAR_ENV_DISABLE_KEY] === SIDECAR_DISABLED_FLAG) {
    return true;
  }
  return false;
}

function resolveSidecarBin(): string {
  try {
    return require.resolve(`@antelopejs/${SIDECAR_BIN_NAME}/dist/index.js`);
  } catch {
    return path.resolve(__dirname, SIDECAR_DIST_REL);
  }
}

function buildCachePath(root: string, fileName: string): string {
  return path.join(root, ...SIDECAR_CACHE_DIR_SEGMENTS, fileName);
}

function readLock(root: string): SidecarLock | null {
  try {
    const raw = readFileSync(
      buildCachePath(root, SIDECAR_LOCK_FILE_NAME),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<SidecarLock>;
    if (typeof parsed.port !== "number" || typeof parsed.pid !== "number") {
      return null;
    }
    return parsed as SidecarLock;
  } catch {
    return null;
  }
}

function removeLockOf(root: string, pid: number): void {
  if (readLock(root)?.pid !== pid) return;
  rmSync(buildCachePath(root, SIDECAR_LOCK_FILE_NAME), { force: true });
}

function isHealthyBody(body: string): boolean {
  try {
    return (JSON.parse(body) as HealthResponse).ok === true;
  } catch {
    return false;
  }
}

function probeHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: SIDECAR_LOOPBACK_HOST,
        port,
        path: SIDECAR_HEALTH_PATH,
        timeout: SIDECAR_HEALTH_TIMEOUT_MS,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve(isHealthyBody(body)));
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A run that crashed or was killed outright leaves its sidecar running: stop
// it, so two sidecars never share the project's state files. Only a sidecar
// that answers its health check is signalled, never a recycled pid.
async function retireLeftoverSidecar(root: string): Promise<void> {
  const lock = readLock(root);
  if (lock === null) return;
  if (!(await probeHealth(lock.port))) return;
  Logging.Info(
    `${SIDECAR_LOG_PREFIX} stopping the sidecar left running on port ${lock.port}`,
  );
  await terminateProcess(lock.pid, SIDECAR_STOP_TIMEOUT_MS);
  removeLockOf(root, lock.pid);
}

function buildSpawnArgs(
  opts: SpawnOptions,
  binPath: string,
  buildId: string,
): string[] {
  const args = [binPath, SIDECAR_BUILD_ID_FLAG, buildId];
  const moduleRoots = opts.moduleRoots ?? [];
  if (moduleRoots.length > 0) {
    args.push(SIDECAR_MODULE_ROOTS_FLAG, JSON.stringify(moduleRoots));
  }
  const skillDirs = opts.skillDirs ?? [];
  if (skillDirs.length > 0) {
    args.push(SIDECAR_SKILL_DIRS_FLAG, JSON.stringify(skillDirs));
  }
  if (opts.builderEnabled) {
    args.push(SIDECAR_BUILDER_FLAG, "1");
  }
  if (opts.backendUrl !== undefined) {
    args.push(SIDECAR_BACKEND_URL_FLAG, opts.backendUrl);
  }
  return args;
}

function trySpawnChild(args: string[], logPath: string): ChildProcess | null {
  try {
    mkdirSync(path.dirname(logPath), { recursive: true });
    const fd = openSync(logPath, "a");
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", fd, fd],
      env: { ...process.env },
    });
    closeSync(fd);
    child.unref();
    return child;
  } catch (err) {
    Logging.Error(`${SIDECAR_LOG_PREFIX} failed to spawn sidecar:`, err);
    return null;
  }
}

async function learnPortFromLock(
  root: string,
  childPid: number,
): Promise<number | null> {
  const deadline = Date.now() + SIDECAR_SPAWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const lock = readLock(root);
    if (lock !== null && lock.pid === childPid) {
      Logging.Info(
        `${SIDECAR_LOG_PREFIX} sidecar listening on port ${lock.port}`,
      );
      return lock.port;
    }
    await delay(SIDECAR_LOCK_POLL_INTERVAL_MS);
  }
  Logging.Error(`${SIDECAR_LOG_PREFIX} sidecar did not report a port in time`);
  return null;
}

function createLaunch(opts: SpawnOptions): SidecarLaunch {
  const root = opts.hostProjectRoot;
  const binPath = resolveSidecarBin();
  const buildId = computeBuildId(path.dirname(binPath));
  const args = buildSpawnArgs(opts, binPath, buildId);
  return {
    buildId,
    spawn: async () => {
      await retireLeftoverSidecar(root);
      return trySpawnChild(args, buildCachePath(root, SIDECAR_LOG_FILE_NAME));
    },
    waitForPort: (pid) => learnPortFromLock(root, pid),
  };
}
