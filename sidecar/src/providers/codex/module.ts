import {
  CODEX_LOG_PREFIX,
  MOCK_CODEX_FLAG_ENABLED,
  MOCK_CODEX_FLAG_ENV,
  OPENAI_API_KEY_ENV_VAR,
} from "../../constants/codex.js";
import { PROVIDER_UNAVAILABLE_REASONS } from "../../constants/providers.js";
import {
  AVAILABLE,
  type ProviderAvailability,
  type ProviderModule,
  unavailable,
} from "../types.js";
import { reapOrphanCodexProcesses } from "./process.js";
import { createCodexProvider } from "./provider.js";
import {
  describeVersionMismatch,
  isCodexInstallationUsable,
  isVersionGateWaived,
  resolveCodexInstallation,
} from "./resolve-binary.js";

// The binary is spawned to read its version, so the verdict is computed once per
// process: neither the installed extension nor the binary changes under a
// running sidecar. The mock binary does change between tests, so it is resolved
// every time instead.
let installVerdict: ProviderAvailability | null = null;

function computeInstallVerdict(): ProviderAvailability {
  const installation = resolveCodexInstallation();
  if (installation === undefined) {
    return unavailable(PROVIDER_UNAVAILABLE_REASONS.CODEX_CLI_MISSING);
  }
  if (!isCodexInstallationUsable(installation)) {
    return unavailable(describeVersionMismatch(installation));
  }
  // Waived rather than matching: the drift is real, and the log is the only
  // place it is still said out loud.
  if (isVersionGateWaived()) {
    console.warn(
      `${CODEX_LOG_PREFIX} ${describeVersionMismatch(installation)}`,
    );
  }
  return AVAILABLE;
}

function isMockCodex(): boolean {
  return process.env[MOCK_CODEX_FLAG_ENV] === MOCK_CODEX_FLAG_ENABLED;
}

function readInstallVerdict(): ProviderAvailability {
  if (isMockCodex()) return computeInstallVerdict();
  installVerdict ??= computeInstallVerdict();
  return installVerdict;
}

function checkAvailability(): ProviderAvailability {
  const installed = readInstallVerdict();
  if (!installed.available) return installed;
  // Read every time: the key is an environment prerequisite, not an install
  // step, so it can appear between two requests.
  if (process.env[OPENAI_API_KEY_ENV_VAR] === undefined) {
    return unavailable(PROVIDER_UNAVAILABLE_REASONS.CODEX_API_KEY_MISSING);
  }
  return AVAILABLE;
}

export const codexModule: ProviderModule = {
  name: "codex",
  create: (options, runtime) =>
    createCodexProvider({
      ...options,
      stateDir: runtime.stateDir,
      mcpHttpRegistry: runtime.mcpHttpRegistry,
      getMcpUrl: runtime.getMcpUrl,
      createMcpDeps: runtime.createMcpDeps,
      // Read here, then written into the isolated home's auth.json: the binary
      // does not read this variable itself.
      getApiKey: () => process.env[OPENAI_API_KEY_ENV_VAR],
    }),
  checkAvailability,
  // Each orphan is a Rust process still holding a model connection and writing
  // to disk, so they are not harmless.
  reapOrphans: async (stateDir) => {
    await reapOrphanCodexProcesses(stateDir);
  },
};
