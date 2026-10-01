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

function sendSignal(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone.
  }
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
 * it. The pid alone is the fallback for an app-server that does not lead a
 * group, as one spawned by an older sidecar does not.
 */
function signalTree(pid: number, signal: NodeJS.Signals): void {
  if (signalGroup(pid, signal)) return;
  sendSignal(pid, signal);
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

const POSIX_STOP_STEPS: readonly StopStep[] = [
  {
    send: (pid) => signalTree(pid, "SIGTERM"),
    waitMs: CODEX_TERMINATE_GRACE_MS,
  },
  { send: (pid) => signalTree(pid, "SIGKILL"), waitMs: CODEX_KILL_GRACE_MS },
];
const WINDOWS_STOP_STEPS: readonly StopStep[] = [
  { send: terminateWindows, waitMs: CODEX_KILL_GRACE_MS },
];

const POSIX_STOP_PLAN: StopPlan = {
  steps: POSIX_STOP_STEPS,
  sweep: sweepGroup,
};
const WINDOWS_STOP_PLAN: StopPlan = {
  steps: WINDOWS_STOP_STEPS,
  sweep: () => {},
};

/** Windows kills a process tree through taskkill, every other host by signal. */
export function isWindowsHost(): boolean {
  return process.platform === WINDOWS_PLATFORM;
}

function platformStopPlan(): StopPlan {
  return isWindowsHost() ? WINDOWS_STOP_PLAN : POSIX_STOP_PLAN;
}

/**
 * Kills whatever is left of a stopped app-server's process tree. Nothing to do
 * on Windows, where the tree went down with it.
 */
export function sweepProcessTree(pid: number): void {
  platformStopPlan().sweep(pid);
}

/**
 * Signals an app-server through each of the platform's steps until it is gone,
 * then sweeps what it left behind. Resolves false when it outlived them all.
 */
export async function runStopSteps(
  pid: number,
  stoppedWithin: StoppedWithin,
): Promise<boolean> {
  const plan = platformStopPlan();
  for (const step of plan.steps) {
    await step.send(pid);
    if (!(await stoppedWithin(step.waitMs))) continue;
    plan.sweep(pid);
    return true;
  }
  return false;
}
