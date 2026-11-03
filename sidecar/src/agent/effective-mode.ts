import type {
  AppSettings,
  ChatMode,
  GenerationMode,
  TurnSettings,
} from "../state/settings-types.js";

export interface ConversationModeState {
  mode: ChatMode;
  generationMode: GenerationMode;
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
): TurnSettings {
  return { ...settings, ...state };
}
