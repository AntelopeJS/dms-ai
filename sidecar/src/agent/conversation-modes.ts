import { effectiveGenerationMode } from "../builder/capability.js";
import type { ConversationModeType } from "../protocol/events.js";
import type { ConversationStore } from "../state/conversations.js";
import type { SettingsStore } from "../state/settings-store.js";
import {
  type AppSettings,
  type ChatMode,
  type GenerationMode,
  modeForProvider,
  type TurnSettings,
} from "../state/settings-types.js";
import type { AssistantMode } from "../state/assistant-mode.js";
import {
  type ConversationModeState,
  conversationSettings,
} from "./effective-mode.js";

export interface ConversationModesPatch {
  mode?: ChatMode;
  generationMode?: GenerationMode;
  assistant?: AssistantMode;
}

export interface ConversationModesDeps {
  conversationStore: ConversationStore;
  settingsStore: SettingsStore;
  /** The assistant mode a conversation starts in when nobody picked one. */
  defaultAssistant: AssistantMode;
  onChanged: (conversationId: string) => void;
}

/**
 * Each conversation's approval mode and scope, persisted with it and
 * defaulting to the settings.
 */
export interface ConversationModes {
  state(conversationId: string): ConversationModeState;
  /** The wire view, generation mode made effective. */
  describe(conversationId: string): ConversationModeType;
  update(conversationId: string, patch: ConversationModesPatch): void;
  /** Stamps the defaults on a conversation that has none yet. */
  pinDefaults(conversationId: string): void;
  settingsFor(conversationId: string, settings: AppSettings): TurnSettings;
  forget(conversationId: string): void;
}

interface ModesState extends ConversationModesDeps {
  /**
   * Modes chosen for a conversation that has no transcript yet: kept here so
   * picking a mode never lists an empty chat in the history.
   */
  drafts: Map<string, ConversationModesPatch>;
}

interface ChosenModes {
  mode: ChatMode;
  generationMode: GenerationMode;
  assistant: AssistantMode;
}

function readChosen(state: ModesState, conversationId: string): ChosenModes {
  const stored = state.conversationStore.get(conversationId);
  const draft = state.drafts.get(conversationId);
  const defaults = state.settingsStore.get();
  return {
    mode:
      stored?.mode ?? draft?.mode ?? defaults.defaultModes[defaults.provider],
    generationMode:
      stored?.generationMode ??
      draft?.generationMode ??
      defaults.generationMode,
    assistant: stored?.assistant ?? draft?.assistant ?? state.defaultAssistant,
  };
}

function readState(
  state: ModesState,
  conversationId: string,
): ConversationModeState {
  const chosen = readChosen(state, conversationId);
  const { provider } = state.settingsStore.get();
  return {
    mode: modeForProvider(provider, chosen.mode),
    generationMode: chosen.generationMode,
    assistant: chosen.assistant,
  };
}

function storeModes(
  state: ModesState,
  conversationId: string,
  patch: ConversationModesPatch,
): void {
  if (state.conversationStore.get(conversationId) === null) {
    const draft = state.drafts.get(conversationId) ?? {};
    state.drafts.set(conversationId, {
      mode: patch.mode ?? draft.mode,
      generationMode: patch.generationMode ?? draft.generationMode,
      assistant: patch.assistant ?? draft.assistant,
    });
    return;
  }
  state.conversationStore.setModes(conversationId, patch);
}

function update(
  state: ModesState,
  conversationId: string,
  patch: ConversationModesPatch,
): void {
  pinDefaults(state, conversationId);
  storeModes(state, conversationId, patch);
  state.onChanged(conversationId);
}

/**
 * Called when a conversation runs a turn (it exists from then on) and before a
 * change: whatever was in force is written down, so a later change of the
 * defaults leaves the conversation alone.
 */
function pinDefaults(state: ModesState, conversationId: string): void {
  const stored = state.conversationStore.get(conversationId);
  if (stored === null) return;
  if (
    stored.mode !== undefined &&
    stored.generationMode !== undefined &&
    stored.assistant !== undefined
  ) {
    return;
  }
  const chosen = readChosen(state, conversationId);
  state.drafts.delete(conversationId);
  state.conversationStore.setModes(conversationId, chosen);
}

export function createConversationModes(
  deps: ConversationModesDeps,
): ConversationModes {
  const state: ModesState = { ...deps, drafts: new Map() };
  return {
    state: (conversationId) => readState(state, conversationId),
    describe(conversationId) {
      const current = readState(state, conversationId);
      return {
        conversationId,
        mode: current.mode,
        generationMode: effectiveGenerationMode(current.generationMode),
        assistant: current.assistant,
      };
    },
    update: (conversationId, patch) => update(state, conversationId, patch),
    pinDefaults: (conversationId) => pinDefaults(state, conversationId),
    settingsFor: (conversationId, settings) =>
      conversationSettings(settings, readState(state, conversationId)),
    forget: (conversationId) => {
      state.drafts.delete(conversationId);
    },
  };
}
