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

const SIDECAR_OWNER_KEY = Symbol.for("@antelopejs/dms-ai/sidecar-owner");
const BACKEND_PATH = path.resolve(__dirname, "helpers/sidecar-backend.cjs");
const INITIAL_BUILD_ID = build.id;
const REBUILT_BUILD_ID = "build-2";
const WAIT_TIMEOUT_MS = 10_000;
const WAIT_STEP_MS = 50;
const ZOMBIE_STATE = "Z";

// The sidecar works in the backend's working directory, where it keeps its lock.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dms-ai-sidecar-"));
process.chdir(root);
const lockPath = path.join(root, "node_modules/.cache/dms-ai/sidecar.lock");
const startedPids = new Set();

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function isZombie(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).startsWith(ZOMBIE_STATE);
  } catch {
    return false;
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return !isZombie(pid);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, label) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(WAIT_STEP_MS);
  }
  assert.fail(`timed out waiting for ${label}`);
}

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

// A sidecar a previous run left behind, of the same build: not a child of the
// launcher's owner, with its lock in place.
async function startLeftover(env = {}) {
  const args = [FAKE_SIDECAR_PATH, "--build-id", build.id];
  const leftover = spawn(process.execPath, args, {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...env },
  });
  track(leftover.pid);
  await waitFor(() => readLock()?.pid === leftover.pid, "the leftover lock");
  return leftover.pid;
}

function signal(pids, name) {
  for (const pid of pids) {
    try {
      process.kill(pid, name);
    } catch {
      continue;
    }
  }
}

// SIGTERM first: a sidecar killed outright counts as a crash, and its owner
// would start another one.
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

// The backend gets its own process group, like the job a terminal runs in the
// foreground: Ctrl+C signals the whole group.
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
  const sidecarPid = track(readLock().pid);
  process.kill(-backendPid, "SIGINT");
  await waitFor(() => !isRunning(sidecarPid), "the sidecar to stop");
  assert.equal(readLock(), null);
});
