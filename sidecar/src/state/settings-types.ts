import type { ProviderName } from "./types.js";

export const CHATBOX_MODES = ["normal", "acceptEdits", "plan", "auto"] as const;
export type ChatboxMode = (typeof CHATBOX_MODES)[number];

export const THINKING_LEVELS = ["off", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

// Safe = the agent acts only through the Builder (MCP) tools; raw file edits are
// blocked. Vibe = full creative range (raw code). Safe requires the Builder to be
// present; when it is absent the client keeps this on "vibe".
export const GENERATION_MODES = ["safe", "vibe"] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export interface AppSettings {
  // Which agent backend drives the conversations. The default is a starting
  // choice, not a safety net: a provider this install cannot drive fails the
  // turn with its reason rather than handing the conversation to another one.
  provider: ProviderName;
  mode: ChatboxMode;
  thinking: ThinkingLevel;
  generationMode: GenerationMode;
  // Opt-in (default off): also load SKILL.md files from the machine-local
  // `~/.claude/skills` dir. Off keeps the agent reproducible across machines.
  allowLocalSkills: boolean;
}
