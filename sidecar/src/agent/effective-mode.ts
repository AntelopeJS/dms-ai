import { effectiveGenerationMode } from "../builder/capability.js";
import type {
  AppSettings,
  ChatMode,
  GenerationMode,
} from "../state/settings-types.js";
import type { FullAutoState } from "../state/types.js";

// The provider mode a Full auto conversation runs in. In Code mode the agent
// keeps asking (`normal`) and the permission bus answers for the user, so every
// call is still seen, recorded as `full_auto`, and the always-ask set still
// reaches the user. Safe mode caps Full auto at `acceptEdits`: the prompts that
// remain there (reads outside the workspace, web access) must reach the user.
const FULL_AUTO_PROVIDER_MODE: Record<GenerationMode, ChatMode> = {
  safe: "acceptEdits",
  vibe: "normal",
};

/** A conversation's own approval state: its mode, scope and Full auto. */
export interface ConversationModeState {
  mode: ChatMode;
  generationMode: GenerationMode;
  fullAuto: FullAutoState | null;
}

/** Whether the bus approves for the user: Full auto, and not in safe mode. */
export function isFullAutoInForce(state: ConversationModeState): boolean {
  if (state.fullAuto === null) return false;
  return effectiveGenerationMode(state.generationMode) === "vibe";
}

/**
 * The settings a conversation's turns run under: the global ones (provider,
 * thinking, skills) with the conversation's own mode and scope. Every consumer
 * of the mode reads it through here: the Claude permission mode and the Codex
 * policy.
 */
export function conversationSettings(
  settings: AppSettings,
  state: ConversationModeState,
): AppSettings {
  const generationMode = effectiveGenerationMode(state.generationMode);
  const mode =
    state.fullAuto === null
      ? state.mode
      : FULL_AUTO_PROVIDER_MODE[generationMode];
  return { ...settings, mode, generationMode: state.generationMode };
}
