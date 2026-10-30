const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { interceptRequire } = require("./helpers/intercept-require.cjs");

const BACKEND_URL = "http://127.0.0.1:41234";

/**
 * @param {unknown[]} registrations - Receives each frontend module registered.
 * @param {unknown[]} sidecars - Receives the options of each sidecar spawned.
 */
function loadModule(registrations, sidecars) {
  const filename = require.resolve("../dist/index.js");
  /** @type {Record<string, unknown>} */
  const mocks = {
    "@antelopejs/interface-dms/page": {
      /** @param {unknown} registration - The frontend module being registered. */
      AddFrontendModule: (registration) => registrations.push(registration),
    },
    "@antelopejs/interface-core/logging": {
      Logging: { Error() {} },
    },
    "./builder/presence": { isBuilderAvailable: () => true },
    "./lifecycle/module-roots": {
      collectModuleRoots: () => ["fixture-module"],
    },
    "./lifecycle/skill-sources": {
      collectSkillSources: () => ["fixture-skills"],
    },
    "./lifecycle/spawn-sidecar": {
      /** @param {unknown} options - The options the sidecar is spawned with. */
      spawnSidecar: async (options) => {
        sidecars.push(options);
      },
    },
    "./logging/log-buffer": { startLogCapture() {} },
    "./frontend-module": require("../dist/frontend-module.js"),
    "node:path": path,
    zod: require("zod"),
    "./constants/sidecar": require("../dist/constants/sidecar.js"),
    "./config": require("../dist/config.js"),
  };
  const restoreRequire = interceptRequire(mocks, true, module);
  try {
    delete require.cache[filename];
    return require("../dist/index.js");
  } finally {
    restoreRequire();
    delete require.cache[filename];
  }
}
void test("registers Vue with its /ai backend prefix and preserves sidecar inputs without launching an agent", async () => {
  /** @type {unknown[]} */
  const registrations = [];
  /** @type {unknown[]} */
  const sidecars = [];
  const loaded = loadModule(registrations, sidecars);
  loaded.construct({ backendUrl: BACKEND_URL });
  await loaded.start();
  assert.deepEqual(registrations, [
    {
      name: "@antelopejs/dms-ai-frontend-vue",
      sourcePath: path.resolve(__dirname, "../frontend-vue"),
      renderer: { name: "vue", version: "3" },
      priority: 100,
      backendProxies: [{ path: "/ai/**", auth: "session" }],
    },
  ]);
  assert.deepEqual(sidecars, [
    {
      hostProjectRoot: process.cwd(),
      backendUrl: BACKEND_URL,
      moduleRoots: ["fixture-module"],
      skillDirs: ["fixture-skills"],
      builderEnabled: true,
    },
  ]);
});

void test("omits the origins the project did not configure", async () => {
  /** @type {unknown[]} */
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

void test("ignores config entries that are not usable origins", async () => {
  /** @type {unknown[]} */
  const sidecars = [];
  const loaded = loadModule([], sidecars);
  loaded.construct({ backendUrl: "   ", unknown: 5010 });
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
