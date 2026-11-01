import {
  OPENAI_API_KEY_ENV_VAR,
  OPENAI_API_KEY_IGNORED_WARNING,
} from "../../constants/chatgpt.js";
import {
  CODEX_LOG_PREFIX,
  MOCK_CODEX_FLAG_ENABLED,
  MOCK_CODEX_FLAG_ENV,
} from "../../constants/codex.js";
import { PROVIDER_UNAVAILABLE_REASONS } from "../../constants/providers.js";
import {
  AVAILABLE,
  type ProviderAvailability,
  type ProviderModule,
  unavailable,
} from "../types.js";
import { readAccountStatus } from "./chatgpt/credentials.js";
import { reapOrphanCodexProcesses } from "./process.js";
import { createCodexProvider } from "./provider.js";
import {
  describeVersionMismatch,
  isCodexInstallationUsable,
  isVersionGateWaived,
  resolveCodexInstallation,
} from "./resolve-binary.js";

/**
 * The binary is spawned to read its version, so the verdict is computed once per
 * process: neither the installed extension nor the binary changes under a
 * running sidecar. The mock binary does change between tests, so it is resolved
 * every time instead.
 */
let installVerdict: ProviderAvailability | null = null;

/**
 * Resolves the installation and checks its version. A waived version gate is
 * logged rather than silent: the drift is real, and the log is the only place
 * it is still said out loud.
 */
function computeInstallVerdict(): ProviderAvailability {
  const installation = resolveCodexInstallation();
  if (installation === undefined) {
    return unavailable(PROVIDER_UNAVAILABLE_REASONS.CODEX_CLI_MISSING);
  }
  if (!isCodexInstallationUsable(installation)) {
    return unavailable(describeVersionMismatch(installation));
  }
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

/**
 * The install verdict, then the account status. The account status is read
 * every time: signing in or out happens while the sidecar runs, in this sidecar
 * or in another project's.
 */
function checkAvailability(): ProviderAvailability {
  const installed = readInstallVerdict();
  if (!installed.available) return installed;
  if (!readAccountStatus().isSignedIn) {
    return unavailable(PROVIDER_UNAVAILABLE_REASONS.CODEX_NOT_SIGNED_IN);
  }
  return AVAILABLE;
}

/**
 * Codex used to run on OPENAI_API_KEY. A key still set would otherwise suggest
 * it is being billed; said once per sidecar start, in the log only.
 */
function warnIfApiKeySet(): void {
  if (process.env[OPENAI_API_KEY_ENV_VAR] === undefined) return;
  console.warn(`${CODEX_LOG_PREFIX} ${OPENAI_API_KEY_IGNORED_WARNING}`);
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
    }),
  checkAvailability,
  /**
   * Each orphan is a Rust process still holding a model connection and writing
   * to disk, so they are not harmless.
   */
  reapOrphans: async (stateDir) => {
    warnIfApiKeySet();
    await reapOrphanCodexProcesses(stateDir);
  },
};
