import { afterEach, describe, expect, it, vi } from "vitest";
import { createConversationModes } from "../../src/agent/conversation-modes.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { createConversationStore } from "../../src/state/conversations.js";
import type { SettingsStore } from "../../src/state/settings-store.js";
import type { AppSettings } from "../../src/state/settings-types.js";
import type { StoredState } from "../../src/state/types.js";

const CONVERSATION_ID = "conv-modes";
const THIRTY_MINUTES_MS = 30 * 60_000;

function settingsStore(settings: AppSettings): SettingsStore {
  let current = settings;
  return {
    get: () => current,
    set: (next) => {
      current = next;
    },
    load: () => Promise.resolve(),
    flush: () => Promise.resolve(),
  };
}

function build(defaults: Partial<AppSettings> = {}) {
  const conversationStore = createConversationStore({
    store: {
      read: async (): Promise<StoredState> => ({ conversations: {} }),
      write: () => {},
      flush: async () => {},
    },
  });
  const settings = settingsStore({ ...DEFAULT_SETTINGS, ...defaults });
  const changes: Array<[string, boolean]> = [];
  const modes = createConversationModes({
    conversationStore,
    settingsStore: settings,
    onChanged: (id, hasEnded) => changes.push([id, hasEnded]),
  });
  return { modes, conversationStore, settings, changes };
}

afterEach(() => {
  vi.useRealTimers();
  setBuilderAvailable(false);
});

describe("conversation modes", () => {
  it("defaults a new chat to the settings, then pins them on its first turn", () => {
    const { modes, conversationStore, settings } = build({
      mode: "plan",
      generationMode: "vibe",
    });
    expect(modes.describe(CONVERSATION_ID)).toMatchObject({
      mode: "plan",
      fullAuto: null,
    });
    conversationStore.appendMessage(CONVERSATION_ID, {
      role: "user",
      content: "hi",
      timestampMs: 1,
    });
    modes.pinDefaults(CONVERSATION_ID);
    settings.set({ ...settings.get(), mode: "acceptEdits" });
    expect(modes.state(CONVERSATION_ID).mode).toBe("plan");
  });

  it("keeps a mode chosen before the first message without listing the chat", () => {
    const { modes, conversationStore } = build();
    modes.update(CONVERSATION_ID, { mode: "acceptEdits" });
    expect(conversationStore.list()).toEqual([]);
    expect(modes.state(CONVERSATION_ID).mode).toBe("acceptEdits");
    conversationStore.appendMessage(CONVERSATION_ID, {
      role: "user",
      content: "hi",
      timestampMs: 1,
    });
    modes.pinDefaults(CONVERSATION_ID);
    expect(conversationStore.get(CONVERSATION_ID)?.mode).toBe("acceptEdits");
  });

  it("ends a turn-scoped Full auto when the turn ends", () => {
    const { modes, changes } = build({ generationMode: "vibe" });
    modes.update(CONVERSATION_ID, { fullAuto: { duration: "turn" } });
    expect(modes.isFullAuto(CONVERSATION_ID)).toBe(true);
    modes.leave(CONVERSATION_ID);
    expect(modes.isFullAuto(CONVERSATION_ID)).toBe(true);
    modes.endTurn(CONVERSATION_ID);
    expect(modes.isFullAuto(CONVERSATION_ID)).toBe(false);
    expect(changes.at(-1)).toEqual([CONVERSATION_ID, true]);
  });

  it("ends a chat-scoped Full auto when the chat closes", () => {
    const { modes } = build({ generationMode: "vibe" });
    modes.update(CONVERSATION_ID, { fullAuto: { duration: "chat" } });
    modes.endTurn(CONVERSATION_ID);
    expect(modes.isFullAuto(CONVERSATION_ID)).toBe(true);
    modes.leave(CONVERSATION_ID);
    expect(modes.isFullAuto(CONVERSATION_ID)).toBe(false);
  });

  it("ends a 30-minute Full auto on the clock", () => {
    vi.useFakeTimers();
    const { modes } = build({ generationMode: "vibe" });
    modes.update(CONVERSATION_ID, { fullAuto: { duration: "30m" } });
    expect(modes.describe(CONVERSATION_ID).fullAuto?.untilMs).toBeGreaterThan(
      Date.now(),
    );
    vi.advanceTimersByTime(THIRTY_MINUTES_MS);
    expect(modes.isFullAuto(CONVERSATION_ID)).toBe(false);
  });

  it("does not answer for the user in safe mode, where Full auto is capped", () => {
    setBuilderAvailable(true);
    const { modes } = build({ generationMode: "safe" });
    modes.update(CONVERSATION_ID, { fullAuto: { duration: "chat" } });
    expect(modes.isFullAuto(CONVERSATION_ID)).toBe(false);
    expect(modes.settingsFor(CONVERSATION_ID, DEFAULT_SETTINGS).mode).toBe(
      "acceptEdits",
    );
    modes.update(CONVERSATION_ID, { fullAuto: null });
    expect(modes.describe(CONVERSATION_ID).fullAuto).toBeNull();
  });
});
