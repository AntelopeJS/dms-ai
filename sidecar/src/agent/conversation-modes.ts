import { effectiveGenerationMode } from "../builder/capability.js";
import type { FullAutoDuration } from "../constants/audit.js";
import { MS_PER_MINUTE } from "../constants/settings.js";
import type { ConversationModeType } from "../protocol/events.js";
import type { ConversationStore } from "../state/conversations.js";
import type { SettingsStore } from "../state/settings-store.js";
import type {
  AppSettings,
  ChatMode,
  GenerationMode,
} from "../state/settings-types.js";
import type { FullAutoState } from "../state/types.js";
import {
  type ConversationModeState,
  conversationSettings,
  isFullAutoInForce,
} from "./effective-mode.js";

const FULL_AUTO_TIMED_MINUTES = 30;

// How long each Full auto duration lasts on the clock; the others end on an
// event (the turn ending, the chat closing).
const FULL_AUTO_CLOCK_MS: Partial<Record<FullAutoDuration, number>> = {
  "30m": FULL_AUTO_TIMED_MINUTES * MS_PER_MINUTE,
};

export interface ConversationModesPatch {
  mode?: ChatMode;
  generationMode?: GenerationMode;
  fullAuto?: FullAutoRequest | null;
}

export interface FullAutoRequest {
  duration: FullAutoDuration;
}

export interface ConversationModesDeps {
  conversationStore: ConversationStore;
  settingsStore: SettingsStore;
  /** The conversation's mode changed; `hasFullAutoEnded` when it ran out. */
  onChanged: (conversationId: string, hasFullAutoEnded: boolean) => void;
}

/**
 * Each conversation's approval mode and scope (persisted with it, defaulting to
 * the settings) and its Full auto (in memory: a restart ends it).
 */
export interface ConversationModes {
  state(conversationId: string): ConversationModeState;
  /** The wire view, generation mode made effective. */
  describe(conversationId: string): ConversationModeType;
  update(conversationId: string, patch: ConversationModesPatch): void;
  /** Stamps the defaults on a conversation that has none yet. */
  pinDefaults(conversationId: string): void;
  settingsFor(conversationId: string, settings: AppSettings): AppSettings;
  isFullAuto(conversationId: string): boolean;
  /** A turn of the conversation ended: ends "this turn" Full auto. */
  endTurn(conversationId: string): void;
  /** The chat closed or another opened: ends "until the chat closes". */
  leave(conversationId: string): void;
  forget(conversationId: string): void;
}

interface FullAutoEntry {
  state: FullAutoState;
  timer?: ReturnType<typeof setTimeout>;
}

interface ModesState extends ConversationModesDeps {
  fullAuto: Map<string, FullAutoEntry>;
  // Modes chosen for a conversation that has no transcript yet: kept here so
  // picking a mode never lists an empty chat in the history.
  drafts: Map<string, ConversationModesPatch>;
}

function readState(
  state: ModesState,
  conversationId: string,
): ConversationModeState {
  const stored = state.conversationStore.get(conversationId);
  const draft = state.drafts.get(conversationId);
  const defaults = state.settingsStore.get();
  return {
    mode: stored?.mode ?? draft?.mode ?? defaults.mode,
    generationMode:
      stored?.generationMode ??
      draft?.generationMode ??
      defaults.generationMode,
    fullAuto: state.fullAuto.get(conversationId)?.state ?? null,
  };
}

function clearFullAuto(state: ModesState, conversationId: string): boolean {
  const entry = state.fullAuto.get(conversationId);
  if (entry === undefined) return false;
  clearTimeout(entry.timer);
  state.fullAuto.delete(conversationId);
  return true;
}

function endFullAuto(
  state: ModesState,
  conversationId: string,
  duration: FullAutoDuration,
): void {
  const entry = state.fullAuto.get(conversationId);
  if (entry?.state.duration !== duration) return;
  clearFullAuto(state, conversationId);
  state.onChanged(conversationId, true);
}

function startFullAuto(
  state: ModesState,
  conversationId: string,
  request: FullAutoRequest,
): void {
  clearFullAuto(state, conversationId);
  const clockMs = FULL_AUTO_CLOCK_MS[request.duration];
  if (clockMs === undefined) {
    state.fullAuto.set(conversationId, {
      state: { duration: request.duration },
    });
    return;
  }
  const timer = setTimeout(
    () => endFullAuto(state, conversationId, request.duration),
    clockMs,
  );
  timer.unref();
  state.fullAuto.set(conversationId, {
    state: { duration: request.duration, untilMs: Date.now() + clockMs },
    timer,
  });
}

function applyFullAuto(
  state: ModesState,
  conversationId: string,
  request: FullAutoRequest | null | undefined,
): void {
  if (request === undefined) return;
  if (request === null) {
    clearFullAuto(state, conversationId);
    return;
  }
  startFullAuto(state, conversationId, request);
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
  storeModes(state, conversationId, {
    mode: patch.mode,
    generationMode: patch.generationMode,
  });
  applyFullAuto(state, conversationId, patch.fullAuto);
  state.onChanged(conversationId, false);
}

// Called when a conversation runs a turn (it exists from then on) and before a
// change: whatever was in force is written down, so a later change of the
// defaults leaves the conversation alone.
function pinDefaults(state: ModesState, conversationId: string): void {
  const stored = state.conversationStore.get(conversationId);
  if (stored === null) return;
  if (stored.mode !== undefined && stored.generationMode !== undefined) return;
  const current = readState(state, conversationId);
  state.drafts.delete(conversationId);
  state.conversationStore.setModes(conversationId, {
    mode: current.mode,
    generationMode: current.generationMode,
  });
}

export function createConversationModes(
  deps: ConversationModesDeps,
): ConversationModes {
  const state: ModesState = {
    ...deps,
    fullAuto: new Map(),
    drafts: new Map(),
  };
  return {
    state: (conversationId) => readState(state, conversationId),
    describe(conversationId) {
      const current = readState(state, conversationId);
      return {
        conversationId,
        mode: current.mode,
        generationMode: effectiveGenerationMode(current.generationMode),
        fullAuto: current.fullAuto,
      };
    },
    update: (conversationId, patch) => update(state, conversationId, patch),
    pinDefaults: (conversationId) => pinDefaults(state, conversationId),
    settingsFor: (conversationId, settings) =>
      conversationSettings(settings, readState(state, conversationId)),
    isFullAuto: (conversationId) =>
      isFullAutoInForce(readState(state, conversationId)),
    endTurn: (conversationId) => endFullAuto(state, conversationId, "turn"),
    leave: (conversationId) => endFullAuto(state, conversationId, "chat"),
    forget: (conversationId) => {
      clearFullAuto(state, conversationId);
      state.drafts.delete(conversationId);
    },
  };
}
