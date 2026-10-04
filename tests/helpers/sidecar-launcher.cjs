const Module = require("node:module");
const path = require("node:path");

const DIST_DIR = path.resolve(__dirname, "../../dist");
const FAKE_SIDECAR_PATH = path.resolve(__dirname, "fake-sidecar.cjs");
const SIDECAR_BIN_REQUEST = "@antelopejs/dms-ai-sidecar/dist/index.js";
const SILENT_LOGGING = { Logging: { Info() {}, Warn() {}, Error() {} } };

/** Build id the launcher computes; a test changes it to simulate a rebuild. */
const build = { id: "build-1" };

const stubs = {
  "@antelopejs/interface-core/logging": () => SILENT_LOGGING,
  "./build-id": () => ({ computeBuildId: () => build.id }),
};

// The launcher starts the fake sidecar instead of the real one, which needs a
// build, and runs outside the core, so its logs go nowhere.
function stubLauncherDependencies() {
  const originalLoad = Module._load;
  const originalResolve = Module._resolveFilename;
  Module._load = function (request, ...rest) {
    const stub = stubs[request];
    return stub ? stub() : originalLoad.call(this, request, ...rest);
  };
  Module._resolveFilename = function (request, ...rest) {
    if (request === SIDECAR_BIN_REQUEST) return FAKE_SIDECAR_PATH;
    return originalResolve.call(this, request, ...rest);
  };
}

/**
 * Loads a new generation of the module's launcher, the way a hot reload does:
 * every compiled file is evicted and only `globalThis` survives.
 */
function loadLauncherGeneration() {
  for (const file of Object.keys(require.cache)) {
    if (file.startsWith(DIST_DIR)) delete require.cache[file];
  }
  return require(path.join(DIST_DIR, "lifecycle/spawn-sidecar.js"));
}

stubLauncherDependencies();

module.exports = { build, FAKE_SIDECAR_PATH, loadLauncherGeneration };
