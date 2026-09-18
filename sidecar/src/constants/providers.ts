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

// Codex asks for a reasoning effort level, Claude for a thinking-token budget.
// One control drives both, so its hint says what the level means per provider.
export const THINKING_HINTS = {
  claude: "Thinking budget handed to the model.",
  codex:
    "Reasoning effort handed to the model; Codex has no 'off', so it maps to the lowest level.",
} as const;

export const PROVIDER_SWITCH_LOG = "[dms-ai] agent provider switched:";
