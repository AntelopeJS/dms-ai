// Reasons a provider is offered greyed out rather than selectable. Short enough
// to sit under a select in both frontends, specific enough to act on.
export const PROVIDER_UNAVAILABLE_REASONS = {
  CLAUDE_SDK_MISSING:
    "The Claude agent SDK is not installed alongside the sidecar.",
  CODEX_CLI_MISSING:
    "Install @openai/codex, at the exact version dms-ai pins, to enable this provider.",
  CODEX_VERSION_MISMATCH:
    "The installed codex binary does not match the protocol types the sidecar ships.",
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

export const PROVIDER_SWITCH_LOG = "[dms-ai] agent provider switched:";
