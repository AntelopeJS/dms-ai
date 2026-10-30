const Module = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DIST_DIR = path.resolve(__dirname, "../../dist");
const FAKE_SIDECAR_PATH = path.resolve(__dirname, "fake-sidecar.cjs");
const SIDECAR_BIN_REQUEST = "@antelopejs/dms-ai-sidecar/dist/index.js";
const SILENT_LOGGING = { Logging: { Info() {}, Warn() {}, Error() {} } };
/**
 * The launcher's five-second grace before SIGKILL, shortened: the case of a
 * sidecar that ignores SIGTERM would otherwise sit through all of it.
 */
const TEST_STOP_TIMEOUT_MS = 500;

/** Build id the launcher computes; a test changes it to simulate a rebuild. */
const build = { id: "build-1" };

const stubs = {
  [require.resolve("@antelopejs/interface-core/logging")]: SILENT_LOGGING,
  [path.join(DIST_DIR, "lifecycle/build-id.js")]: {
    computeBuildId: () => build.id,
  },
};

/**
 * Seeds the module cache with the stubs, which `require` then returns in place
 * of the real modules.
 */
function installStubs() {
  for (const [filename, exports] of Object.entries(stubs)) {
    const stub = new Module(filename);
    stub.filename = filename;
    stub.exports = exports;
    stub.loaded = true;
    require.cache[filename] = stub;
  }
}

/**
 * The launcher starts the fake sidecar instead of the real one, which needs a
 * build, and runs outside the core, so its logs go nowhere.
 */
function stubLauncherDependencies() {
  installStubs();
  Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier !== SIDECAR_BIN_REQUEST) {
        return nextResolve(specifier, context);
      }
      return {
        url: pathToFileURL(FAKE_SIDECAR_PATH).href,
        format: "commonjs",
        shortCircuit: true,
      };
    },
  });
}

/**
 * Loads a new generation of the module's launcher, the way a hot reload does:
 * every compiled file is evicted and only `globalThis` survives.
 */
function loadLauncherGeneration() {
  for (const file of Object.keys(require.cache)) {
    if (file.startsWith(DIST_DIR)) delete require.cache[file];
  }
  installStubs();
  const constants = require("../../dist/constants/sidecar.js");
  constants.SIDECAR_STOP_TIMEOUT_MS = TEST_STOP_TIMEOUT_MS;
  return require("../../dist/lifecycle/spawn-sidecar.js");
}

stubLauncherDependencies();

module.exports = { build, FAKE_SIDECAR_PATH, loadLauncherGeneration };
