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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!signalProcess(pid, LIVENESS_SIGNAL)) return true;
    await delay(SIDECAR_EXIT_POLL_INTERVAL_MS);
  }
  return !signalProcess(pid, LIVENESS_SIGNAL);
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
