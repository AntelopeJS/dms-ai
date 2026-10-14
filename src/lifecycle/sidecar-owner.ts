import type { ChildProcess } from "node:child_process";
import { Logging } from "@antelopejs/interface-core/logging";
import {
  SIDECAR_LOG_PREFIX,
  SIDECAR_OWNER_KEY,
  SIDECAR_RESPAWN_DELAY_MS,
  SIDECAR_STOP_TIMEOUT_MS,
  SIDECAR_SUCCESS_EXIT_CODE,
} from "../constants/sidecar";
import { createRespawnTracker, type RespawnTracker } from "./respawn-tracker";
import { terminateProcess } from "./terminate-process";

/** How the loaded generation of the module starts a sidecar of its build. */
export interface SidecarLaunch {
  buildId: string;
  spawn(): Promise<ChildProcess | null>;
  waitForPort(pid: number): Promise<number | null>;
}

/**
 * Owner of the sidecar child process, shared by every generation of the module
 * loaded in this process: a hot reload attaches the new generation to the
 * running sidecar instead of starting another one.
 */
export interface SidecarOwner {
  /** Makes the generation's launch current and starts a sidecar of its build if none runs. */
  attach(launch: SidecarLaunch): Promise<void>;
  /** Starts the sidecar again after an idle exit, unless it gave up after crashing. */
  revive(): Promise<void>;
  /**
   * Stops the running sidecar and starts a fresh one of the current build,
   * even after it gave up: the crash budget starts over.
   */
  restart(): Promise<void>;
  getPort(): number | null;
  hasGivenUp(): boolean;
}

interface OwnedSidecar {
  child: ChildProcess;
  buildId: string;
  port: number | null;
}

interface OwnerState {
  launch: SidecarLaunch | null;
  current: OwnedSidecar | null;
  inFlight: Promise<void> | null;
  hasGivenUp: boolean;
  respawnTracker: RespawnTracker;
}

interface OwnerRegistry {
  [ownerKey]?: SidecarOwner;
}

const ownerKey = Symbol.for(SIDECAR_OWNER_KEY);

export function getSidecarOwner(): SidecarOwner {
  const registry = globalThis as OwnerRegistry;
  registry[ownerKey] ??= createSidecarOwner();
  return registry[ownerKey];
}

function createSidecarOwner(): SidecarOwner {
  const state: OwnerState = {
    launch: null,
    current: null,
    inFlight: null,
    hasGivenUp: false,
    respawnTracker: createRespawnTracker(),
  };
  return {
    attach: (launch) => attach(state, launch),
    revive: () => ensureRunning(state),
    restart: () => restart(state),
    getPort: () => state.current?.port ?? null,
    hasGivenUp: () => state.hasGivenUp,
  };
}

function attach(state: OwnerState, launch: SidecarLaunch): Promise<void> {
  state.launch = launch;
  state.hasGivenUp = false;
  return ensureRunning(state);
}

function ensureRunning(state: OwnerState): Promise<void> {
  const launch = state.launch;
  if (launch === null || state.hasGivenUp) return Promise.resolve();
  if (state.inFlight !== null) return state.inFlight;
  if (state.current?.buildId === launch.buildId) return Promise.resolve();
  state.inFlight = replaceSidecar(state, launch).finally(() => {
    state.inFlight = null;
  });
  return state.inFlight;
}

async function restart(state: OwnerState): Promise<void> {
  const launch = state.launch;
  if (launch === null) return;
  await state.inFlight;
  state.hasGivenUp = false;
  state.respawnTracker = createRespawnTracker();
  state.inFlight = replaceSidecar(state, launch).finally(() => {
    state.inFlight = null;
  });
  await state.inFlight;
}

async function replaceSidecar(
  state: OwnerState,
  launch: SidecarLaunch,
): Promise<void> {
  await retireCurrent(state);
  const child = await launch.spawn();
  if (child === null) return;
  const owned: OwnedSidecar = { child, buildId: launch.buildId, port: null };
  state.current = owned;
  child.on("exit", (code) => handleExit(state, owned, code));
  child.on("error", (err) => logError("sidecar process error", err));
  owned.port = await launch.waitForPort(child.pid ?? -1);
}

async function retireCurrent(state: OwnerState): Promise<void> {
  const retired = state.current;
  if (retired === null) return;
  state.current = null;
  await terminateProcess(retired.child.pid, SIDECAR_STOP_TIMEOUT_MS);
}

function handleExit(
  state: OwnerState,
  owned: OwnedSidecar,
  code: number | null,
): void {
  if (state.current !== owned) return;
  state.current = null;
  if (code === SIDECAR_SUCCESS_EXIT_CODE) {
    Logging.Info(`${SIDECAR_LOG_PREFIX} sidecar exited gracefully`);
    return;
  }
  scheduleRespawnIfBudget(state);
}

function scheduleRespawnIfBudget(state: OwnerState): void {
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
  setTimeout(() => void ensureRunning(state), SIDECAR_RESPAWN_DELAY_MS);
}

function logError(message: string, err: unknown): void {
  Logging.Error(`${SIDECAR_LOG_PREFIX} ${message}:`, err);
}
