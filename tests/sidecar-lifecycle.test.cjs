const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const events = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, afterEach, test } = require("node:test");
const {
  build,
  FAKE_SIDECAR_PATH,
  loadLauncherGeneration,
} = require("./helpers/sidecar-launcher.cjs");
const {
  isZombie,
  readLockFile,
  readPidFile,
} = require("./helpers/process-state.cjs");

const SIDECAR_OWNER_KEY = Symbol.for("@antelopejs/dms-ai/sidecar-owner");
const BACKEND_PATH = path.resolve(__dirname, "helpers/sidecar-backend.cjs");
const INITIAL_BUILD_ID = build.id;
const REBUILT_BUILD_ID = "build-2";
const WAIT_TIMEOUT_MS = 10_000;
const WAIT_STEP_MS = 50;
const ANSWER_WITHIN_MS = 2_500;
const SPAWN_TIMEOUT_WITHIN_MS = 8_000;

/** The sidecar works in the backend's working directory, where it keeps its lock. */
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dms-ai-sidecar-"));
process.chdir(root);
const lockPath = path.join(root, "node_modules/.cache/dms-ai/sidecar.lock");
/** @type {Set<number>} */
const startedPids = new Set();

function readLock() {
  return readLockFile(lockPath);
}

/** @param {number} pid */
function isRunning(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return !isZombie(pid);
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {() => boolean} check
 * @param {string} label
 */
async function waitFor(check, label) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(WAIT_STEP_MS);
  }
  assert.fail(`timed out waiting for ${label}`);
}

/**
 * Runs `action` while `Date.now` answers one instant for good, as the demo's
 * capture clock makes it, and puts the real clock back when it ends.
 * @template T
 * @param {() => Promise<T>} action
 * @returns {Promise<T>}
 */
async function onFrozenClock(action) {
  const realNow = Date.now;
  const instant = realNow();
  Date.now = () => instant;
  try {
    return await action();
  } finally {
    Date.now = realNow;
  }
}

/**
 * Fails instead of hanging when `work` outlasts `ms`, measured on a timer the
 * frozen clock does not touch.
 * @template T
 * @param {Promise<T>} work
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function within(work, ms, label) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const expired = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} took more than ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

/**
 * @param {"crash" | "silent"} mode
 * @param {() => Promise<void>} action
 */
async function withFakeMode(mode, action) {
  process.env.FAKE_SIDECAR_MODE = mode;
  try {
    await action();
  } finally {
    delete process.env.FAKE_SIDECAR_MODE;
    const pidFile = path.join(root, "silent.pid");
    const silentPid = readPidFile(pidFile);
    if (silentPid !== null) track(silentPid);
    fs.rmSync(pidFile, { force: true });
  }
}

/** @param {number} pid */
function track(pid) {
  startedPids.add(pid);
  return pid;
}

async function startSidecar() {
  const launcher = loadLauncherGeneration();
  await launcher.spawnSidecar({ hostProjectRoot: root });
  const lock = readLock();
  assert.ok(lock, "the sidecar claimed the lock");
  track(lock.pid);
  return { launcher, lock };
}

/**
 * A sidecar a previous run left behind, of the same build: not a child of the
 * launcher's owner, with its lock in place.
 * @param {Record<string, string>} [env]
 */
async function startLeftover(env = {}) {
  const args = [FAKE_SIDECAR_PATH, "--build-id", build.id];
  const leftover = spawn(process.execPath, args, {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...env },
  });
  const leftoverPid = leftover.pid;
  assert.ok(leftoverPid !== undefined, "the leftover started");
  track(leftoverPid);
  await waitFor(() => readLock()?.pid === leftoverPid, "the leftover lock");
  return leftoverPid;
}

/**
 * @param {number[]} pids
 * @param {NodeJS.Signals} name
 */
function signal(pids, name) {
  for (const pid of pids) {
    try {
      process.kill(pid, name);
    } catch {
      continue;
    }
  }
}

afterEach(async () => {
  const pids = [...startedPids];
  startedPids.clear();
  signal(pids, "SIGTERM");
  await waitFor(
    () => !pids.some(isRunning),
    "the test processes to stop",
  ).catch(() => signal(pids, "SIGKILL"));
  delete globalThis[SIDECAR_OWNER_KEY];
  build.id = INITIAL_BUILD_ID;
  fs.rmSync(lockPath, { force: true });
});

after(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(root, { recursive: true, force: true });
});

void test("a hot reload of the module keeps the running sidecar", async () => {
  const first = await startSidecar();
  const second = await startSidecar();
  assert.equal(second.lock.pid, first.lock.pid);
  assert.equal(second.launcher.getSidecarPort(), first.lock.port);
  assert.ok(isRunning(first.lock.pid));
});

void test("a hot reload with a rebuilt sidecar replaces it", async () => {
  const first = await startSidecar();
  build.id = REBUILT_BUILD_ID;
  const second = await startSidecar();
  assert.notEqual(second.lock.pid, first.lock.pid);
  assert.equal(second.lock.buildId, REBUILT_BUILD_ID);
  assert.equal(isRunning(first.lock.pid), false);
  assert.equal(second.launcher.getSidecarPort(), second.lock.port);
});

void test("a restart replaces the running sidecar with a fresh one of the same build", async () => {
  const first = await startSidecar();
  await first.launcher.restartSidecar();
  const lock = readLock();
  assert.ok(lock, "the new sidecar claimed the lock");
  track(lock.pid);
  assert.notEqual(lock.pid, first.lock.pid);
  assert.equal(lock.buildId, first.lock.buildId);
  assert.equal(isRunning(first.lock.pid), false);
  assert.equal(first.launcher.getSidecarPort(), lock.port);
  assert.equal(first.launcher.hasSidecarGivenUp(), false);
});

void test("a sidecar left by an earlier run is stopped, not reused", async () => {
  const leftoverPid = await startLeftover();
  const { lock } = await startSidecar();
  assert.notEqual(lock.pid, leftoverPid);
  assert.equal(isRunning(leftoverPid), false);
});

void test("a leftover sidecar that ignores SIGTERM is killed", async () => {
  const leftoverPid = await startLeftover({
    FAKE_SIDECAR_IGNORE_SHUTDOWN: "1",
  });
  const { lock } = await startSidecar();
  assert.notEqual(lock.pid, leftoverPid);
  await waitFor(() => !isRunning(leftoverPid), "the leftover to be killed");
});

void test("stopping the backend with Ctrl+C stops its sidecar", async () => {
  const backend = spawn(process.execPath, [BACKEND_PATH], {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const backendPid = backend.pid;
  assert.ok(backendPid !== undefined, "the backend started");
  track(backendPid);
  await events.once(backend.stdout, "data");
  const lock = readLock();
  assert.ok(lock, "the sidecar claimed the lock");
  const sidecarPid = track(lock.pid);
  process.kill(-backendPid, "SIGINT");
  await waitFor(() => !isRunning(sidecarPid), "the sidecar to stop");
  assert.equal(readLock(), null);
});

void test("a sidecar that exits before it claims the lock is given up on, not waited for", async () => {
  await withFakeMode("crash", async () => {
    const launcher = loadLauncherGeneration();
    await within(
      launcher.spawnSidecar({ hostProjectRoot: root }),
      ANSWER_WITHIN_MS,
      "spawnSidecar",
    );
    await within(
      launcher.ensureSidecarRunning(),
      ANSWER_WITHIN_MS,
      "ensureSidecarRunning",
    );
    assert.equal(launcher.isSidecarRunning(), false);
    await waitFor(
      () => launcher.hasSidecarGivenUp(),
      "the crash budget to be spent",
    );
  });
});

void test("the wait for a sidecar that exits ends on a frozen clock too", async () => {
  await withFakeMode("crash", async () => {
    const launcher = loadLauncherGeneration();
    await onFrozenClock(async () => {
      await within(
        launcher.spawnSidecar({ hostProjectRoot: root }),
        ANSWER_WITHIN_MS,
        "spawnSidecar",
      );
      await within(
        launcher.ensureSidecarRunning(),
        ANSWER_WITHIN_MS,
        "ensureSidecarRunning",
      );
    });
    assert.equal(launcher.isSidecarRunning(), false);
    await waitFor(
      () => launcher.hasSidecarGivenUp(),
      "the crash budget to be spent",
    );
  });
});

void test("the wait for a sidecar that never claims the lock times out on a frozen clock", async () => {
  await withFakeMode("silent", async () => {
    const launcher = loadLauncherGeneration();
    await onFrozenClock(() =>
      within(
        launcher.spawnSidecar({ hostProjectRoot: root }),
        SPAWN_TIMEOUT_WITHIN_MS,
        "spawnSidecar",
      ),
    );
    assert.equal(launcher.isSidecarRunning(), false);
  });
});

void test("a leftover sidecar that ignores SIGTERM is killed on a frozen clock too", async () => {
  const leftoverPid = await startLeftover({
    FAKE_SIDECAR_IGNORE_SHUTDOWN: "1",
  });
  const launcher = loadLauncherGeneration();
  await onFrozenClock(() =>
    within(
      launcher.spawnSidecar({ hostProjectRoot: root }),
      ANSWER_WITHIN_MS,
      "spawnSidecar",
    ),
  );
  const lock = readLock();
  assert.ok(lock, "the new sidecar claimed the lock");
  track(lock.pid);
  assert.notEqual(lock.pid, leftoverPid);
  assert.equal(isRunning(leftoverPid), false);
});
