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
