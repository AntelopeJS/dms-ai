import { type ChildProcess, spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
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
  SIDECAR_DIST_EXTENSION,
  SIDECAR_DIST_REL,
  SIDECAR_ENV_DISABLE_KEY,
  SIDECAR_HEALTH_PATH,
  SIDECAR_HEALTH_TIMEOUT_MS,
  SIDECAR_HOST_ORIGIN_FLAG,
  SIDECAR_LOCK_FILE_NAME,
  SIDECAR_LOCK_POLL_INTERVAL_MS,
  SIDECAR_LOG_FILE_NAME,
  SIDECAR_LOG_PREFIX,
  SIDECAR_LOOPBACK_HOST,
  SIDECAR_MODULE_ROOTS_FLAG,
  SIDECAR_RESPAWN_DELAY_MS,
  SIDECAR_SKILL_DIRS_FLAG,
  SIDECAR_SPAWN_TIMEOUT_MS,
  SIDECAR_SUCCESS_EXIT_CODE,
} from "../constants/sidecar";
import { createRespawnTracker, type RespawnTracker } from "./respawn-tracker";
import type { SkillSource } from "./skill-sources";

interface SpawnOptions {
  hostProjectRoot: string;
  // Origin the DMS frontend is served from, and origin the sidecar's registry,
  // logs and builder clients call the backend on. Both come from the module
  // config; left out, the sidecar keeps its own standalone defaults.
  hostOrigin?: string;
  backendUrl?: string;
  // Authoritative module roots (from interface-core) auto-allowed for read-only
  // tools. Captured in state so an idle-revive respawn reuses the same set.
  moduleRoots?: string[];
  // Skill sources contributed by loaded modules (`antelopeJs.skills`). Captured
  // in state so an idle-revive respawn reuses the same set.
  skillDirs?: SkillSource[];
  // Whether the dms-builder interface is provided, unlocking the sidecar's
  // safe-mode builder tools. Captured in state so a respawn keeps the same mode.
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

interface HealthInfo {
  version: string;
  buildId: string;
}

interface HealthResponse {
  ok?: boolean;
  version?: string;
  buildId?: string;
}

interface SidecarState {
  child: ChildProcess | null;
  port: number | null;
  respawnTracker: RespawnTracker;
  hasGivenUp: boolean;
  options: SpawnOptions | null;
  inFlight: Promise<void> | null;
}

const WINDOWS_PLATFORM = "win32";

type OriginOption = "backendUrl" | "hostOrigin";

const ORIGIN_FLAGS: Record<string, OriginOption> = {
  [SIDECAR_BACKEND_URL_FLAG]: "backendUrl",
  [SIDECAR_HOST_ORIGIN_FLAG]: "hostOrigin",
};

const state: SidecarState = {
  child: null,
  port: null,
  respawnTracker: createRespawnTracker(),
  hasGivenUp: false,
  options: null,
  inFlight: null,
};

export function getSidecarPort(): number | null {
  return state.port;
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
  return state.port !== null;
}

// True once the crash budget is spent: the sidecar is deliberately down and a
// probe can no longer revive it, so the client should stop waiting and warn.
export function hasSidecarGivenUp(): boolean {
  return state.hasGivenUp;
}

// True when spawning is turned off for this process (production or the disable
// env flag); the client uses it to skip injecting the assistant entirely rather
// than show a perpetually-reconnecting icon.
export function isSidecarDisabled(): boolean {
  return mustSkipSpawn();
}

export async function spawnSidecar(opts: SpawnOptions): Promise<void> {
  state.options = opts;
  await ensureSidecarRunning();
}

// Idempotent revive: brings the sidecar back if it has idle-exited (or never
// started), and is a no-op while one is already running or being spawned.
// Called both at boot and on every /ai/sidecar-info probe so navigation
// transparently respawns the daemon after its idle shutdown. Stays a no-op
// once the crash budget is exhausted (hasGivenUp), so probe traffic can't
// re-arm a sidecar that has deliberately given up — recovery then requires a
// restart/reload.
export async function ensureSidecarRunning(): Promise<void> {
  if (mustSkipSpawn()) return;
  if (state.hasGivenUp) return;
  if (state.options === null) return;
  if (state.inFlight !== null) return state.inFlight;
  if (state.port !== null) {
    // An owned child clears state.port from its exit handler when it dies, so a
    // non-null port can be trusted. An *adopted* sidecar (reused via the lock
    // file, state.child === null) gives us no exit signal, so verify it is
    // actually alive — otherwise a dead reused daemon leaves a stale port
    // reported as running and the client would point its frame at a dead port.
    if (state.child !== null) return;
    if ((await probeHealth(state.port)) !== null) return;
    state.port = null;
  }
  if (state.child !== null) return;
  state.inFlight = ensureSidecar(state.options.hostProjectRoot).finally(() => {
    state.inFlight = null;
  });
  return state.inFlight;
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

function computeBuildId(binPath: string): string {
  try {
    const distDir = path.dirname(binPath);
    const entries = readdirSync(distDir, { recursive: true }) as string[];
    let maxMtime = 0;
    for (const entry of entries) {
      if (!entry.endsWith(SIDECAR_DIST_EXTENSION)) continue;
      const mtime = statSync(path.join(distDir, entry)).mtimeMs;
      if (mtime > maxMtime) maxMtime = mtime;
    }
    return String(maxMtime);
  } catch {
    return "";
  }
}

function parseHealth(body: string): HealthInfo | null {
  try {
    const parsed = JSON.parse(body) as HealthResponse;
    if (parsed.ok !== true) return null;
    return { version: parsed.version ?? "", buildId: parsed.buildId ?? "" };
  } catch {
    return null;
  }
}

function probeHealth(port: number): Promise<HealthInfo | null> {
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
        res.on("end", () => resolve(parseHealth(body)));
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function adoptSidecar(port: number): void {
  state.child = null;
  state.port = port;
  Logging.Info(`${SIDECAR_LOG_PREFIX} reusing sidecar on port ${port}`);
}

function killPid(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
}

async function retireStaleSidecar(lock: SidecarLock): Promise<void> {
  killPid(lock.pid);
  const deadline = Date.now() + SIDECAR_SPAWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const health = await probeHealth(lock.port);
    if (health === null) return;
    await delay(SIDECAR_LOCK_POLL_INTERVAL_MS);
  }
}

async function tryReuse(root: string, buildId: string): Promise<boolean> {
  const lock = readLock(root);
  if (lock === null) return false;
  const health = await probeHealth(lock.port);
  if (health === null) return false;
  if (health.buildId === buildId) {
    adoptSidecar(lock.port);
    return true;
  }
  await retireStaleSidecar(lock);
  return false;
}

function buildSpawnArgs(binPath: string, buildId: string): string[] {
  const args = [binPath, SIDECAR_BUILD_ID_FLAG, buildId];
  const moduleRoots = state.options?.moduleRoots ?? [];
  if (moduleRoots.length > 0) {
    args.push(SIDECAR_MODULE_ROOTS_FLAG, JSON.stringify(moduleRoots));
  }
  const skillDirs = state.options?.skillDirs ?? [];
  if (skillDirs.length > 0) {
    args.push(SIDECAR_SKILL_DIRS_FLAG, JSON.stringify(skillDirs));
  }
  if (state.options?.builderEnabled) {
    args.push(SIDECAR_BUILDER_FLAG, "1");
  }
  for (const [flag, option] of Object.entries(ORIGIN_FLAGS)) {
    const origin = state.options?.[option];
    if (origin !== undefined) args.push(flag, origin);
  }
  return args;
}

function trySpawnChild(
  binPath: string,
  buildId: string,
  logPath: string,
): ChildProcess | null {
  try {
    mkdirSync(path.dirname(logPath), { recursive: true });
    const fd = openSync(logPath, "a");
    const detached = process.platform !== WINDOWS_PLATFORM;
    const child = spawn(process.execPath, buildSpawnArgs(binPath, buildId), {
      detached,
      stdio: ["ignore", fd, fd],
      env: { ...process.env },
    });
    closeSync(fd);
    if (detached) child.unref();
    return child;
  } catch (err) {
    logError("failed to spawn sidecar", err);
    return null;
  }
}

async function learnPortFromLock(
  root: string,
  childPid: number,
): Promise<void> {
  const deadline = Date.now() + SIDECAR_SPAWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const lock = readLock(root);
    if (lock !== null && lock.pid === childPid) {
      state.port = lock.port;
      Logging.Info(
        `${SIDECAR_LOG_PREFIX} sidecar listening on port ${lock.port}`,
      );
      return;
    }
    await delay(SIDECAR_LOCK_POLL_INTERVAL_MS);
  }
  Logging.Error(`${SIDECAR_LOG_PREFIX} sidecar did not report a port in time`);
}

async function freshSpawn(
  root: string,
  binPath: string,
  buildId: string,
): Promise<void> {
  const logPath = buildCachePath(root, SIDECAR_LOG_FILE_NAME);
  const child = trySpawnChild(binPath, buildId, logPath);
  if (child === null) return;
  state.child = child;
  state.port = null;
  wireChildExit(child);
  await learnPortFromLock(root, child.pid ?? -1);
}

async function ensureSidecar(root: string): Promise<void> {
  const binPath = resolveSidecarBin();
  const buildId = computeBuildId(binPath);
  const reused = await tryReuse(root, buildId);
  if (reused) return;
  await freshSpawn(root, binPath, buildId);
}

function wireChildExit(child: ChildProcess): void {
  child.on("exit", (code) => handleChildExit(code));
  child.on("error", (err) => logError("sidecar process error", err));
}

function handleChildExit(code: number | null): void {
  state.child = null;
  state.port = null;
  if (code === SIDECAR_SUCCESS_EXIT_CODE) {
    Logging.Info(`${SIDECAR_LOG_PREFIX} sidecar exited gracefully`);
    return;
  }
  scheduleRespawnIfBudget();
}

function scheduleRespawnIfBudget(): void {
  const now = Date.now();
  if (!state.respawnTracker.hasBudget(now)) {
    state.hasGivenUp = true;
    Logging.Error(
      `${SIDECAR_LOG_PREFIX} sidecar crash budget exhausted, giving up`,
    );
    return;
  }
  state.respawnTracker.recordAttempt(now);
  Logging.Error(
    `${SIDECAR_LOG_PREFIX} sidecar crashed, respawning in ${SIDECAR_RESPAWN_DELAY_MS}ms`,
  );
  setTimeout(performScheduledRespawn, SIDECAR_RESPAWN_DELAY_MS);
}

function performScheduledRespawn(): void {
  if (state.hasGivenUp) return;
  void ensureSidecarRunning();
}

function logError(message: string, err: unknown): void {
  Logging.Error(`${SIDECAR_LOG_PREFIX} ${message}:`, err);
}
