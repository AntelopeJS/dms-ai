import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  SIDECAR_LOCK_FILE_NAME,
  SIDECAR_LOCK_TEMP_SUFFIX,
} from "../constants/daemon.js";
import { STATE_DIR_SEGMENTS } from "../constants/paths.js";

export interface SidecarLock {
  port: number;
  pid: number;
  version: string;
  buildId: string;
  startedAt: number;
  token: string;
  clientToken: string;
}

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export function buildLockPath(root: string): string {
  return join(root, ...STATE_DIR_SEGMENTS, SIDECAR_LOCK_FILE_NAME);
}

export async function writeLock(
  root: string,
  lock: SidecarLock,
): Promise<void> {
  const lockPath = buildLockPath(root);
  await mkdir(dirname(lockPath), {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE,
  });
  const tempPath = `${lockPath}${SIDECAR_LOCK_TEMP_SUFFIX}`;
  const file = await open(tempPath, "w", PRIVATE_FILE_MODE);
  try {
    await file.chmod(PRIVATE_FILE_MODE);
    await file.writeFile(JSON.stringify(lock), "utf8");
  } finally {
    await file.close();
  }
  await rename(tempPath, lockPath);
}

async function readLockPid(lockPath: string): Promise<number | null> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as {
      pid?: unknown;
    };
    return typeof parsed.pid === "number" ? parsed.pid : null;
  } catch {
    return null;
  }
}

// Removes the lock only when this process owns it, so a retired/orphaned instance
// can't delete the live sidecar's lock and cause the backend to spawn a duplicate.
export async function removeLock(
  root: string,
  ownerPid: number = process.pid,
): Promise<void> {
  const lockPath = buildLockPath(root);
  const pid = await readLockPid(lockPath);
  if (pid !== null && pid !== ownerPid) return;
  await rm(lockPath).catch(() => undefined);
}
