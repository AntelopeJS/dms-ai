import { createRequire } from "node:module";
import { REAL_SDK_PACKAGE } from "../../constants/claude.js";
import { PROVIDER_UNAVAILABLE_REASONS } from "../../constants/providers.js";
import {
  AVAILABLE,
  type ProviderAvailability,
  type ProviderModule,
  unavailable,
} from "../types.js";
import { createClaudeProvider } from "./provider.js";

// Resolved by specifier, never imported: the SDK is loaded lazily, and this
// only has to answer whether it is installed at all.
function isSdkInstalled(): boolean {
  try {
    createRequire(import.meta.url).resolve(REAL_SDK_PACKAGE);
    return true;
  } catch {
    return false;
  }
}

function checkAvailability(): ProviderAvailability {
  if (isSdkInstalled()) return AVAILABLE;
  return unavailable(PROVIDER_UNAVAILABLE_REASONS.CLAUDE_SDK_MISSING);
}

// In-process: the MCP server reaches it through the session context, so none of
// the runtime is used here.
export const claudeModule: ProviderModule = {
  name: "claude",
  create: (options) => createClaudeProvider(options),
  checkAvailability,
};
