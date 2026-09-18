import { createRequire } from "node:module";
import { REAL_SDK_PACKAGE } from "../constants/claude.js";
import {
  MOCK_CODEX_FLAG_ENABLED,
  MOCK_CODEX_FLAG_ENV,
  OPENAI_API_KEY_ENV_VAR,
} from "../constants/codex.js";
import { PROVIDER_UNAVAILABLE_REASONS } from "../constants/providers.js";
import {
  DEFAULT_PROVIDER_NAME,
  PROVIDER_NAMES,
  type ProviderName,
} from "../state/types.js";
import {
  isCodexInstallationUsable,
  resolveCodexInstallation,
} from "./codex/resolve-binary.js";

export interface ProviderAvailability {
  available: boolean;
  /** Why the provider is greyed out; absent when it is available. */
  reason?: string;
}

export type ProviderAvailabilityMap = Record<
  ProviderName,
  ProviderAvailability
>;

const AVAILABLE: ProviderAvailability = { available: true };

function unavailable(reason: string): ProviderAvailability {
  return { available: false, reason };
}

function isSdkInstalled(): boolean {
  try {
    createRequire(import.meta.url).resolve(REAL_SDK_PACKAGE);
    return true;
  } catch {
    return false;
  }
}

function claudeAvailability(): ProviderAvailability {
  if (!isSdkInstalled()) {
    return unavailable(PROVIDER_UNAVAILABLE_REASONS.CLAUDE_SDK_MISSING);
  }
  return AVAILABLE;
}

// The binary is spawned to read its version, so the verdict is computed once per
// process: neither the installed extension nor the binary changes under a
// running sidecar. The mock binary does change between tests, so it is resolved
// every time instead.
let codexVerdict: ProviderAvailability | null = null;

function computeCodexAvailability(): ProviderAvailability {
  const installation = resolveCodexInstallation();
  if (installation === undefined) {
    return unavailable(PROVIDER_UNAVAILABLE_REASONS.CODEX_CLI_MISSING);
  }
  if (!isCodexInstallationUsable(installation)) {
    return unavailable(PROVIDER_UNAVAILABLE_REASONS.CODEX_VERSION_MISMATCH);
  }
  return AVAILABLE;
}

function isMockCodex(): boolean {
  return process.env[MOCK_CODEX_FLAG_ENV] === MOCK_CODEX_FLAG_ENABLED;
}

function codexInstallVerdict(): ProviderAvailability {
  if (isMockCodex()) return computeCodexAvailability();
  codexVerdict ??= computeCodexAvailability();
  return codexVerdict;
}

function codexAvailability(): ProviderAvailability {
  const installed = codexInstallVerdict();
  if (!installed.available) return installed;
  // Read every time: the key is an environment prerequisite, not an install
  // step, so it can appear between two requests.
  if (process.env[OPENAI_API_KEY_ENV_VAR] === undefined) {
    return unavailable(PROVIDER_UNAVAILABLE_REASONS.CODEX_API_KEY_MISSING);
  }
  return AVAILABLE;
}

const AVAILABILITY_BY_PROVIDER: Record<
  ProviderName,
  () => ProviderAvailability
> = {
  claude: claudeAvailability,
  codex: codexAvailability,
};

/** Per-provider verdict, as exposed next to `builderAvailable` in GET /settings. */
export function getProviderAvailability(): ProviderAvailabilityMap {
  const entries = PROVIDER_NAMES.map((name) => [
    name,
    AVAILABILITY_BY_PROVIDER[name](),
  ]);
  return Object.fromEntries(entries) as ProviderAvailabilityMap;
}

export function isProviderAvailable(name: ProviderName): boolean {
  return AVAILABILITY_BY_PROVIDER[name]().available;
}

/**
 * The provider a session actually runs on. A selected-but-incomplete provider
 * falls back to the default instead of failing the turn, mirroring how safe
 * generation mode degrades to vibe when the Builder is absent.
 */
export function effectiveProvider(name: ProviderName): ProviderName {
  return isProviderAvailable(name) ? name : DEFAULT_PROVIDER_NAME;
}
