import type { StopGraces } from "../../src/providers/codex/stop.js";

/**
 * The real graces only matter against a wedged app-server in the field; the
 * cases that outwait them in tests would otherwise sit through seconds each.
 */
export const TEST_STOP_GRACES: StopGraces = { terminateMs: 300, killMs: 300 };

/**
 * Whether a pid is still taken. Signal 0 only asks the question, on every
 * POSIX host, where /proc would limit it to Linux.
 */
export function isRunning(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
