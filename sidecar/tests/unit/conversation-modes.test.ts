import { afterEach, describe, expect, it } from "vitest";
import { createConversationModes } from "../../src/agent/conversation-modes.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import {
  type ConversationStore,
  createConversationStore,
} from "../../src/state/conversations.js";
import type { SettingsStore } from "../../src/state/settings-store.js";
import type { AppSettings } from "../../src/state/settings-types.js";
import type { StoredState } from "../../src/state/types.js";

const CONVERSATION_ID = "conv-modes";
const OTHER_CONVERSATION_ID = "conv-modes-other";

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
  const modes = createConversationModes({
    conversationStore,
    settingsStore: settings,
    defaultAssistant: "builder",
    onChanged: () => {},
  });
  return { modes, conversationStore, settings };
}

function startChat(conversationStore: ConversationStore, id: string): void {
  conversationStore.appendMessage(id, {
    role: "user",
    content: "hi",
    timestampMs: 1,
  });
}

afterEach(() => {
  setBuilderAvailable(false);
});

describe("conversation modes", () => {
  it("defaults a new chat to the settings, then pins them on its first turn", () => {
    const { modes, conversationStore, settings } = build({
      defaultModes: { claude: "plan", codex: "normal" },
      generationMode: "vibe",
    });
    expect(modes.describe(CONVERSATION_ID)).toStrictEqual({
      conversationId: CONVERSATION_ID,
      mode: "plan",
      generationMode: "vibe",
      assistant: "builder",
    });
    startChat(conversationStore, CONVERSATION_ID);
    modes.pinDefaults(CONVERSATION_ID);
    settings.set({
      ...settings.get(),
      defaultModes: { claude: "acceptEdits", codex: "normal" },
    });
    expect(modes.state(CONVERSATION_ID).mode).toBe("plan");
  });

  it("starts a fresh chat in Auto review on Claude Code and Ask first on Codex", () => {
    const { modes, settings } = build();
    expect(modes.describe(CONVERSATION_ID).mode).toBe("auto");
    settings.set({ ...settings.get(), provider: "codex" });
    expect(modes.describe(OTHER_CONVERSATION_ID).mode).toBe("normal");
  });

  it("asks first on Codex for a chat in Auto review, and is back in Auto review on Claude Code", () => {
    const { modes, conversationStore, settings } = build();
    startChat(conversationStore, CONVERSATION_ID);
    modes.pinDefaults(CONVERSATION_ID);
    settings.set({ ...settings.get(), provider: "codex" });
    expect(modes.describe(CONVERSATION_ID).mode).toBe("normal");
    expect(modes.settingsFor(CONVERSATION_ID, settings.get()).mode).toBe(
      "normal",
    );
    expect(conversationStore.get(CONVERSATION_ID)?.mode).toBe("auto");
    settings.set({ ...settings.get(), provider: "claude" });
    expect(modes.describe(CONVERSATION_ID).mode).toBe("auto");
  });

  it("pins the mode a chat chose, not the one the current provider reads", () => {
    const { modes, conversationStore, settings } = build();
    modes.update(CONVERSATION_ID, { mode: "auto" });
    settings.set({ ...settings.get(), provider: "codex" });
    startChat(conversationStore, CONVERSATION_ID);
    modes.pinDefaults(CONVERSATION_ID);
    settings.set({ ...settings.get(), provider: "claude" });
    expect(modes.state(CONVERSATION_ID).mode).toBe("auto");
  });

  it("keeps a mode chosen before the first message without listing the chat", () => {
    const { modes, conversationStore } = build();
    modes.update(CONVERSATION_ID, { mode: "acceptEdits" });
    expect(conversationStore.list()).toEqual([]);
    expect(modes.state(CONVERSATION_ID).mode).toBe("acceptEdits");
    startChat(conversationStore, CONVERSATION_ID);
    modes.pinDefaults(CONVERSATION_ID);
    expect(conversationStore.get(CONVERSATION_ID)?.mode).toBe("acceptEdits");
  });
});
