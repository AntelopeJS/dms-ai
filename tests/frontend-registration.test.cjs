const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");

const BACKEND_URL = "http://127.0.0.1:41234";
const HOST_ORIGIN = "http://localhost:4173";

function loadModule(registrations, sidecars) {
  const filename = path.resolve(__dirname, "../dist/index.js");
  const mocks = {
    "@antelopejs/interface-dms/page": {
      AddFrontendModule: (registration) => registrations.push(registration),
    },
    "./builder/presence": { isBuilderAvailable: () => true },
    "./lifecycle/module-roots": {
      collectModuleRoots: () => ["fixture-module"],
    },
    "./lifecycle/skill-sources": {
      collectSkillSources: () => ["fixture-skills"],
    },
    "./lifecycle/spawn-sidecar": {
      spawnSidecar: async (options) => {
        sidecars.push(options);
      },
    },
    "./logging/log-buffer": { startLogCapture() {} },
    "./constants/frontend-module": {
      FRONTEND_MODULE_DIR: "../frontend-vue",
      FRONTEND_MODULE_NAME: "@antelopejs/dms-ai-frontend-vue",
      FRONTEND_MODULE_PRIORITY: 100,
    },
    "node:path": path,
    // The config store is the unit under test here, so it is loaded for real.
    "./config": require(path.resolve(__dirname, "../dist/config.js")),
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

test("registers Vue and preserves sidecar inputs without launching an agent", async () => {
  const registrations = [];
  const sidecars = [];
  const loaded = loadModule(registrations, sidecars);
  loaded.construct({ backendUrl: BACKEND_URL, hostOrigin: HOST_ORIGIN });
  await loaded.start();
  assert.deepEqual(registrations, [
    {
      name: "@antelopejs/dms-ai-frontend-vue",
      sourcePath: path.resolve(__dirname, "../frontend-vue"),
      renderer: { name: "vue", version: "3" },
      priority: 100,
    },
  ]);
  assert.deepEqual(sidecars, [
    {
      hostProjectRoot: process.cwd(),
      backendUrl: BACKEND_URL,
      hostOrigin: HOST_ORIGIN,
      moduleRoots: ["fixture-module"],
      skillDirs: ["fixture-skills"],
      builderEnabled: true,
    },
  ]);
});

test("omits the origins the project did not configure", async () => {
  const sidecars = [];
  const loaded = loadModule([], sidecars);
  loaded.construct(undefined);
  await loaded.start();
  assert.deepEqual(sidecars, [
    {
      hostProjectRoot: process.cwd(),
      moduleRoots: ["fixture-module"],
      skillDirs: ["fixture-skills"],
      builderEnabled: true,
    },
  ]);
});

test("ignores config entries that are not usable origins", async () => {
  const sidecars = [];
  const loaded = loadModule([], sidecars);
  loaded.construct({ backendUrl: "   ", hostOrigin: 5010 });
  await loaded.start();
  assert.deepEqual(sidecars, [
    {
      hostProjectRoot: process.cwd(),
      moduleRoots: ["fixture-module"],
      skillDirs: ["fixture-skills"],
      builderEnabled: true,
    },
  ]);
});
