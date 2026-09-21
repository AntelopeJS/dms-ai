// Reasons a provider is offered greyed out rather than selectable. Short enough
// to sit under a select in both frontends, specific enough to act on.
export const PROVIDER_UNAVAILABLE_REASONS = {
  CLAUDE_SDK_MISSING:
    "The Claude agent SDK is not installed alongside the sidecar.",
  CODEX_CLI_MISSING:
    "Install @openai/codex, at the exact version dms-ai pins, to enable this provider.",
  // Codex versions the app-server protocol by binary and ships about ten
  // releases a month, so the mismatch is the expected state after any upgrade.
  // Saying which version to pin back to is what makes it actionable.
  CODEX_VERSION_MISMATCH:
    "The installed codex binary (%installed%) does not match the protocol types the sidecar ships (%pinned%). Install @openai/codex@%pinned%.",
  CODEX_API_KEY_MISSING:
    "Set OPENAI_API_KEY in the host environment to enable this provider.",
} as const;

export const PROVIDER_LABELS = {
  claude: "Anthropic (Claude)",
  codex: "OpenAI (Codex)",
} as const;

// Raised when a turn asks for a provider this install cannot drive. The chosen
// backend is never silently swapped for another one: someone who picked OpenAI
// may have picked it precisely so their code does not go to Anthropic, and a
// quiet fallback would betray that. The message carries the reason, so the chat
// says what to do about it.
export const PROVIDER_UNAVAILABLE_ERROR = "%label% cannot run:";
export const PROVIDER_LABEL_TOKEN = "%label%";
export const PROVIDER_INSTALLED_VERSION_TOKEN = "%installed%";
export const PROVIDER_PINNED_VERSION_TOKEN = "%pinned%";
export const PROVIDER_UNKNOWN_VERSION = "unknown";

export const PROVIDER_SWITCH_LOG = "[dms-ai] agent provider switched:";
