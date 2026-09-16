import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildLockPath,
  removeLock,
  type SidecarLock,
  writeLock,
} from "../../src/state/lock.js";

const LOCK: SidecarLock = {
  port: 1234,
  pid: 99,
  version: "1.0.0",
  buildId: "build-1",
  startedAt: 1,
  token: "test-token",
  clientToken: "test-client-token",
};

describe("sidecar lock", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-lock-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes then reads back the lock and removes it (owning pid)", async () => {
    await writeLock(dir, LOCK);
    const raw = await readFile(buildLockPath(dir), "utf8");
    expect(JSON.parse(raw)).toEqual(LOCK);
    expect((await stat(buildLockPath(dir))).mode & 0o777).toBe(0o600);
    await removeLock(dir, LOCK.pid);
    expect(existsSync(buildLockPath(dir))).toBe(false);
  });

  it("does NOT remove a lock owned by a different pid", async () => {
    await writeLock(dir, LOCK);
    // A retired/orphaned instance (different pid) must not clobber the live
    // sidecar's lock, or the backend can't adopt it and spawns a duplicate.
    await removeLock(dir, LOCK.pid + 1);
    expect(existsSync(buildLockPath(dir))).toBe(true);
  });

  it("removeLock is a no-op when the lock is absent", async () => {
    await expect(removeLock(dir)).resolves.toBeUndefined();
  });
});
