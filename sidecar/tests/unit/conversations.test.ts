import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConversationStore } from "../../src/state/conversations.js";
import { createStore } from "../../src/state/store.js";
import type { StoredMessage } from "../../src/state/types.js";

const TMP_PREFIX = "dms-ai-conv-";
const STATE_FILE = "state.json";
const CONVERSATION_ID = "conv-test-1";
const FAST_DEBOUNCE_MS = 10;

const SAMPLE_USER_MESSAGE: StoredMessage = {
  role: "user",
  content: "hello there",
  timestampMs: 1_000,
};

const SAMPLE_ASSISTANT_MESSAGE: StoredMessage = {
  role: "assistant",
  content: "hi back",
  timestampMs: 2_000,
};

const SAMPLE_TOOL_USE: StoredMessage = {
  role: "tool_use",
  content: '{"path":"/tmp"}',
  toolName: "Read",
  callId: "call-1",
  timestampMs: 3_000,
};

const SAMPLE_TOOL_RESULT: StoredMessage = {
  role: "tool_result",
  content: '"ok"',
  callId: "call-1",
  status: "success",
  timestampMs: 4_000,
};

interface Harness {
  dir: string;
  filePath: string;
}

async function makeHarness(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
  return { dir, filePath: join(dir, STATE_FILE) };
}

describe("conversation persistence", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await makeHarness();
  });

  afterEach(async () => {
    await rm(harness.dir, { recursive: true, force: true });
  });

  it("returns null for unknown conversation ids before any persistence", async () => {
    const store = createStore({
      filePath: harness.filePath,
      debounceMs: FAST_DEBOUNCE_MS,
    });
    const conv = createConversationStore({ store });
    await conv.loadFromDisk();
    expect(conv.get(CONVERSATION_ID)).toBeNull();
  });

  it("persists appended messages and restores them after a fresh load", async () => {
    const firstStore = createStore({
      filePath: harness.filePath,
      debounceMs: FAST_DEBOUNCE_MS,
    });
    const firstConv = createConversationStore({ store: firstStore });
    await firstConv.loadFromDisk();
    firstConv.appendMessage(CONVERSATION_ID, SAMPLE_USER_MESSAGE);
    firstConv.appendMessage(CONVERSATION_ID, SAMPLE_ASSISTANT_MESSAGE);
    firstConv.appendMessage(CONVERSATION_ID, SAMPLE_TOOL_USE);
    firstConv.appendMessage(CONVERSATION_ID, SAMPLE_TOOL_RESULT);
    await firstConv.flush();

    const secondStore = createStore({
      filePath: harness.filePath,
      debounceMs: FAST_DEBOUNCE_MS,
    });
    const secondConv = createConversationStore({ store: secondStore });
    await secondConv.loadFromDisk();
    const restored = secondConv.get(CONVERSATION_ID);
    expect(restored).not.toBeNull();
    expect(restored?.messages).toHaveLength(4);
    expect(restored?.messages[0]).toEqual(SAMPLE_USER_MESSAGE);
    expect(restored?.messages[2]?.toolName).toBe("Read");
    expect(restored?.messages[3]?.status).toBe("success");
  });

  it("coalesces rapid writes via debounce, persisting only the latest state", async () => {
    const store = createStore({
      filePath: harness.filePath,
      debounceMs: FAST_DEBOUNCE_MS,
    });
    const conv = createConversationStore({ store });
    await conv.loadFromDisk();
    for (let i = 0; i < 5; i++) {
      conv.appendMessage(CONVERSATION_ID, {
        role: "user",
        content: `msg ${i}`,
        timestampMs: 1_000 + i,
      });
    }
    await conv.flush();

    const reload = createConversationStore({
      store: createStore({
        filePath: harness.filePath,
        debounceMs: FAST_DEBOUNCE_MS,
      }),
    });
    await reload.loadFromDisk();
    const restored = reload.get(CONVERSATION_ID);
    expect(restored?.messages).toHaveLength(5);
    expect(restored?.messages[4]?.content).toBe("msg 4");
  });
});
