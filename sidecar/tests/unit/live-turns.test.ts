import { describe, expect, it } from "vitest";
import type { AnyServerEventType } from "../../src/protocol/events.js";
import { createLiveTurnStore } from "../../src/server/live-turns.js";

const CONVERSATION_ID = "conv-1";

function chunk(text: string): AnyServerEventType {
  return {
    type: "assistant_message_chunk",
    conversationId: CONVERSATION_ID,
    text,
  };
}

function textsOf(events: AnyServerEventType[] | null): string[] {
  if (events === null) return [];
  return events.map((event) => (event as { text: string }).text);
}

describe("live turn store", () => {
  it("replays appended events between begin and end", () => {
    const store = createLiveTurnStore();
    expect(store.replay(CONVERSATION_ID)).toBeNull();
    store.begin(CONVERSATION_ID);
    store.append(CONVERSATION_ID, chunk("a"));
    store.append(CONVERSATION_ID, chunk("b"));
    expect(textsOf(store.replay(CONVERSATION_ID))).toEqual(["a", "b"]);
    store.end(CONVERSATION_ID);
    expect(store.replay(CONVERSATION_ID)).toBeNull();
  });

  it("begin resets the buffer", () => {
    const store = createLiveTurnStore();
    store.begin(CONVERSATION_ID);
    store.append(CONVERSATION_ID, chunk("old"));
    store.begin(CONVERSATION_ID);
    expect(store.replay(CONVERSATION_ID)).toEqual([]);
  });
});
