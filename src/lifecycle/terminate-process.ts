import { SIDECAR_EXIT_POLL_INTERVAL_MS } from "../constants/sidecar";

const LIVENESS_SIGNAL = 0;

function signalProcess(pid: number, signal: NodeJS.Signals | number): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** True while a process with this pid exists; a child that has exited is gone at once. */
export function isProcessAlive(pid: number): boolean {
  return signalProcess(pid, LIVENESS_SIGNAL);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Counts polls instead of reading the clock, so a process that never exits
 * is still killed when `Date.now` stands still.
 */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const polls = Math.ceil(timeoutMs / SIDECAR_EXIT_POLL_INTERVAL_MS);
  for (let poll = 0; poll < polls; poll += 1) {
    if (!isProcessAlive(pid)) return true;
    await delay(SIDECAR_EXIT_POLL_INTERVAL_MS);
  }
  return !isProcessAlive(pid);
}

/**
 * Asks a process to stop with `SIGTERM`, and kills it with `SIGKILL` when it
 * is still running after `timeoutMs`.
 */
export async function terminateProcess(
  pid: number | undefined,
  timeoutMs: number,
): Promise<void> {
  if (pid === undefined || !signalProcess(pid, "SIGTERM")) return;
  if (await waitForExit(pid, timeoutMs)) return;
  signalProcess(pid, "SIGKILL");
}
