const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");

const CHILD_PID = 4242;
const SIDECAR_PORT = 39001;
const BACKEND_URL = "http://127.0.0.1:41234";
const HOST_ORIGIN = "http://localhost:4173";

function buildLock() {
  return JSON.stringify({
    port: SIDECAR_PORT,
    pid: CHILD_PID,
    version: "0.0.0",
    buildId: "",
    startedAt: 0,
  });
}

// Drives the real spawnSidecar with the process and filesystem stubbed: the
// lock file is only claimed by the child we pretend to spawn, so the reuse path
// is skipped and a fresh spawn is forced.
function loadLauncher(spawns) {
  const filename = path.resolve(
    __dirname,
    "../dist/lifecycle/spawn-sidecar.js",
  );
  let spawned = false;
  const mocks = {
    "node:child_process": {
      spawn: (command, args) => {
        spawned = true;
        spawns.push(args);
        return { pid: CHILD_PID, on() {}, unref() {} };
      },
    },
    "node:fs": {
      closeSync() {},
      mkdirSync() {},
      openSync: () => 1,
      readdirSync: () => [],
      readFileSync: () => {
        if (!spawned) throw new Error("no lock yet");
        return buildLock();
      },
      statSync: () => ({ mtimeMs: 0 }),
    },
    "node:http": { get: () => ({ on() {}, destroy() {} }) },
    "node:path": path,
    "@antelopejs/interface-core/logging": {
      Logging: { Info() {}, Error() {} },
    },
    "../constants/module": { PRODUCTION_NODE_ENV: "production" },
    "../constants/sidecar": require(
      path.resolve(__dirname, "../dist/constants/sidecar.js"),
    ),
    "./respawn-tracker": {
      createRespawnTracker: () => ({
        hasBudget: () => true,
        recordAttempt() {},
      }),
    },
  };
  const originalLoad = Module._load;
  Module._load = (request) => mocks[request] ?? {};
  try {
    delete require.cache[filename];
    return originalLoad(filename, module, false);
  } finally {
    Module._load = originalLoad;
    delete require.cache[filename];
  }
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
}

test("passes the configured origins to the sidecar", async () => {
  const spawns = [];
  await loadLauncher(spawns).spawnSidecar({
    hostProjectRoot: process.cwd(),
    backendUrl: BACKEND_URL,
    hostOrigin: HOST_ORIGIN,
  });
  assert.equal(spawns.length, 1);
  assert.equal(valueAfter(spawns[0], "--backend-url"), BACKEND_URL);
  assert.equal(valueAfter(spawns[0], "--host-origin"), HOST_ORIGIN);
});

test("omits both flags when the project configured neither", async () => {
  const spawns = [];
  await loadLauncher(spawns).spawnSidecar({ hostProjectRoot: process.cwd() });
  assert.equal(spawns.length, 1);
  assert.equal(valueAfter(spawns[0], "--backend-url"), null);
  assert.equal(valueAfter(spawns[0], "--host-origin"), null);
});
