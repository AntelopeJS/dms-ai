import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  CHATGPT_CONFIG_DIR_MODE,
  CHATGPT_LOCK_DIR_NAME,
  CHATGPT_LOCK_POLL_MS,
  CHATGPT_LOCK_STALE_MS,
  CHATGPT_LOCK_TIMEOUT_MS,
} from "../../../constants/chatgpt.js";
import { chatGptConfigDir } from "./store.js";

function lockPath(): string {
  return path.join(chatGptConfigDir(), CHATGPT_LOCK_DIR_NAME);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/**
 * A lock left by a sidecar that died mid-refresh would block every other one
 * forever; a refresh never takes this long, so an older lock is abandoned.
 */
async function isStale(lock: string): Promise<boolean> {
  try {
    const info = await stat(lock);
    return Date.now() - info.mtimeMs > CHATGPT_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/**
 * Takes the lock by creating its directory, which is atomic on every platform:
 * exactly one caller creates it. Waits until CHATGPT_LOCK_TIMEOUT_MS, and
 * abandons a stale lock.
 */
async function acquire(lock: string): Promise<void> {
  const deadline = Date.now() + CHATGPT_LOCK_TIMEOUT_MS;
  await mkdir(path.dirname(lock), {
    recursive: true,
    mode: CHATGPT_CONFIG_DIR_MODE,
  });
  for (;;) {
    try {
      await mkdir(lock);
      return;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    if (await isStale(lock)) {
      await rm(lock, { recursive: true, force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${lock}`);
    }
    await wait(CHATGPT_LOCK_POLL_MS);
  }
}

/**
 * Runs `task` holding the machine-wide ChatGPT auth lock. Every sidecar on the
 * machine shares one refresh token, which rotates on use: a refresh has to read
 * the stored token, spend it and write the replacement with no one else in
 * between.
 */
export async function withAuthLock<T>(task: () => Promise<T>): Promise<T> {
  const lock = lockPath();
  await acquire(lock);
  try {
    return await task();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
