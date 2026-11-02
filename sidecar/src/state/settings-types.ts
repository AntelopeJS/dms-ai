import type { ProviderName } from "./types.js";

/**
 * The approval modes a conversation can be in:
 * - `normal` (Ask first): every call that changes something asks.
 * - `auto` (Auto review): the provider's own safety check approves routine
 *   calls and blocks risky ones; every shell command and the always-ask set
 *   still ask.
 * - `acceptEdits`: file edits run unasked, the rest asks.
 * - `plan`: the agent proposes a plan and changes nothing.
 *
 * Full auto is not one of them: it is a time-boxed overlay on one conversation
 * (see agent/conversation-modes), never a stored default.
 */
export const CHAT_MODES = ["normal", "auto", "acceptEdits", "plan"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

export const CODEX_CHAT_MODES = [
  "normal",
  "acceptEdits",
  "plan",
] as const satisfies readonly ChatMode[];
export type CodexChatMode = (typeof CODEX_CHAT_MODES)[number];

const PROVIDER_CHAT_MODES = {
  claude: CHAT_MODES,
  codex: CODEX_CHAT_MODES,
} as const satisfies Record<ProviderName, readonly ChatMode[]>;

/**
 * The mode a provider runs `mode` in: the mode itself when the provider has
 * it, Ask first otherwise.
 */
export function modeForProvider(
  provider: ProviderName,
  mode: ChatMode,
): ChatMode {
  const modes: readonly ChatMode[] = PROVIDER_CHAT_MODES[provider];
  return modes.includes(mode) ? mode : "normal";
}

export type DefaultModes = {
  [P in ProviderName]: (typeof PROVIDER_CHAT_MODES)[P][number];
};

export const THINKING_LEVELS = ["off", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * Safe = the agent acts only through the Builder (MCP) tools; raw file edits are
 * blocked. Vibe = full creative range (raw code). Safe requires the Builder to be
 * present; when it is absent the client keeps this on "vibe".
 */
export const GENERATION_MODES = ["safe", "vibe"] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const REQUEST_TIMEOUT_MINUTES = [5, 15, 30] as const;
type RequestTimeoutMinutes = (typeof REQUEST_TIMEOUT_MINUTES)[number];

export const CHECKPOINT_RETENTION_DAYS = [7, 30, 90] as const;
type CheckpointRetentionDays = (typeof CHECKPOINT_RETENTION_DAYS)[number];

export interface AppSettings {
  /**
   * Which agent backend drives the conversations. The default is a starting
   * choice, not a safety net: a provider this install cannot drive fails the
   * turn with its reason rather than handing the conversation to another one.
   */
  provider: ProviderName;
  /** Default approval mode of new conversations; each one then keeps its own. */
  defaultModes: DefaultModes;
  thinking: ThinkingLevel;
  /**
   * The model Claude Code runs on. The CLI's own default is a smaller model,
   * so the sidecar always names one. Codex picks its own model.
   */
  claudeModel: string;
  /** Default scope of new conversations; each one then keeps its own. */
  generationMode: GenerationMode;
  /**
   * Opt-in (default off): also load SKILL.md files from the machine-local
   * `~/.claude/skills` dir. Off keeps the agent reproducible across machines.
   */
  allowLocalSkills: boolean;
  /** Adding or removing a dependency asks even in Full auto. */
  alwaysAskDependencies: boolean;
  /** Removing or moving a Builder block asks even in Full auto. */
  alwaysAskBlockRemoval: boolean;
  requestTimeoutMinutes: RequestTimeoutMinutes;
  /** Raise a DMS toast when a request arrives while the panel is closed. */
  notifyRequests: boolean;
  checkpointRetentionDays: CheckpointRetentionDays;
}

/**
 * What one conversation's turns run under: the stored settings with the
 * conversation's own approval mode.
 */
export interface TurnSettings extends AppSettings {
  mode: ChatMode;
}
