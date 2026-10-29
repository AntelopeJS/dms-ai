import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  CODEX_KILL_GRACE_MS,
  CODEX_PID_TOKEN,
  CODEX_TERMINATE_GRACE_MS,
  WINDOWS_PLATFORM,
  WINDOWS_TREE_KILL,
} from "../../constants/codex.js";

const execFileAsync = promisify(execFile);

// Windows has no signals: `process.kill` terminates the app-server and leaves
// whatever it spawned behind, so the tree is killed through taskkill instead.
async function terminateWindows(pid: number): Promise<void> {
  const [command, ...args] = WINDOWS_TREE_KILL;
  await execFileAsync(
    command,
    args.map((arg) => arg.replace(CODEX_PID_TOKEN, String(pid))),
    { windowsHide: true },
  ).catch(() => undefined);
}

function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Signals the app-server's process group, which takes whatever it started with
 * it.
 */
function signalTree(pid: number, signal: NodeJS.Signals): void {
  signalGroup(pid, signal);
}

/** Kills what is left of an app-server's group once its leader is gone. */
function sweepGroup(pid: number): void {
  signalGroup(pid, "SIGKILL");
}

interface StopStep {
  send: (pid: number) => void | Promise<void>;
  waitMs: number;
}

interface StopPlan {
  steps: readonly StopStep[];
  sweep: (pid: number) => void;
}

/** Whether the app-server is gone within that wait, once signalled. */
export type StoppedWithin = (waitMs: number) => Promise<boolean>;

/** How long each stop step waits for the app-server to be gone. */
export interface StopGraces {
  terminateMs: number;
  killMs: number;
}

export const DEFAULT_STOP_GRACES: StopGraces = {
  terminateMs: CODEX_TERMINATE_GRACE_MS,
  killMs: CODEX_KILL_GRACE_MS,
};

function posixStopPlan(graces: StopGraces): StopPlan {
  return {
    steps: [
      {
        send: (pid) => signalTree(pid, "SIGTERM"),
        waitMs: graces.terminateMs,
      },
      {
        send: (pid) => signalTree(pid, "SIGKILL"),
        waitMs: graces.killMs,
      },
    ],
    sweep: sweepGroup,
  };
}

function windowsStopPlan(graces: StopGraces): StopPlan {
  return {
    steps: [{ send: terminateWindows, waitMs: graces.killMs }],
    sweep: () => {},
  };
}

/** Windows kills a process tree through taskkill, every other host by signal. */
export function isWindowsHost(): boolean {
  return process.platform === WINDOWS_PLATFORM;
}

function platformStopPlan(graces: StopGraces): StopPlan {
  return isWindowsHost() ? windowsStopPlan(graces) : posixStopPlan(graces);
}

/**
 * Kills whatever is left of a stopped app-server's process tree. Nothing to do
 * on Windows, where the tree went down with it.
 */
export function sweepProcessTree(pid: number): void {
  platformStopPlan(DEFAULT_STOP_GRACES).sweep(pid);
}

/**
 * Signals an app-server through each of the platform's steps until it is gone,
 * then sweeps what it left behind. Resolves false when it outlived them all.
 */
export async function runStopSteps(
  pid: number,
  stoppedWithin: StoppedWithin,
  graces: StopGraces = DEFAULT_STOP_GRACES,
): Promise<boolean> {
  const plan = platformStopPlan(graces);
  for (const step of plan.steps) {
    await step.send(pid);
    if (!(await stoppedWithin(step.waitMs))) continue;
    plan.sweep(pid);
    return true;
  }
  return false;
}
