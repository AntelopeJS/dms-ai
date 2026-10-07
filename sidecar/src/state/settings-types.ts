import type { ProviderName } from "./types.js";

// The approval modes a conversation can be in. Full auto is not one of them:
// it is a time-boxed overlay on one conversation (see agent/conversation-modes),
// never a stored default.
export const CHAT_MODES = ["normal", "acceptEdits", "plan"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

// The mode a pre-v2 settings file may still hold. It reads as `normal`.
export const LEGACY_AUTO_MODE = "auto";

export const THINKING_LEVELS = ["off", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

// Safe = the agent acts only through the Builder (MCP) tools; raw file edits are
// blocked. Vibe = full creative range (raw code). Safe requires the Builder to be
// present; when it is absent the client keeps this on "vibe".
export const GENERATION_MODES = ["safe", "vibe"] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const REQUEST_TIMEOUT_MINUTES = [5, 15, 30] as const;
export type RequestTimeoutMinutes = (typeof REQUEST_TIMEOUT_MINUTES)[number];

export const CHECKPOINT_RETENTION_DAYS = [7, 30, 90] as const;
export type CheckpointRetentionDays =
  (typeof CHECKPOINT_RETENTION_DAYS)[number];

export interface AppSettings {
  // Which agent backend drives the conversations. The default is a starting
  // choice, not a safety net: a provider this install cannot drive fails the
  // turn with its reason rather than handing the conversation to another one.
  provider: ProviderName;
  // Default approval mode of new conversations; each one then keeps its own.
  mode: ChatMode;
  thinking: ThinkingLevel;
  // Default scope of new conversations; each one then keeps its own.
  generationMode: GenerationMode;
  // Opt-in (default off): also load SKILL.md files from the machine-local
  // `~/.claude/skills` dir. Off keeps the agent reproducible across machines.
  allowLocalSkills: boolean;
  // Adding or removing a dependency asks even in Full auto.
  alwaysAskDependencies: boolean;
  // Removing or moving a Builder block asks even in Full auto.
  alwaysAskBlockRemoval: boolean;
  requestTimeoutMinutes: RequestTimeoutMinutes;
  // Raise a DMS toast when a request arrives while the panel is closed.
  notifyRequests: boolean;
  checkpointRetentionDays: CheckpointRetentionDays;
}
