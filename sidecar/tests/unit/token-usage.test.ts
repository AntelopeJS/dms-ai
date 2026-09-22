import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractTokenUsage } from "../../src/providers/claude/adapter.js";
import {
  type ConversationStore,
  createConversationStore,
} from "../../src/state/conversations.js";
import { createStore } from "../../src/state/store.js";

const TMP_PREFIX = "dms-ai-usage-";
const STATE_FILE = "state.json";
const CONVERSATION_ID = "conv-usage-1";
const FAST_DEBOUNCE_MS = 10;

function resultMessage(usage: Record<string, number>): SDKMessage {
  return { type: "result", usage } as unknown as SDKMessage;
}

describe("token usage extraction", () => {
  it("counts cached and cache-write input as input", () => {
    const usage = extractTokenUsage(
      resultMessage({
        input_tokens: 100,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 5,
        output_tokens: 30,
      }),
    );
    expect(usage).toEqual({
      inputTokens: 125,
      outputTokens: 30,
      totalTokens: 155,
    });
  });

  it("ignores any message that is not the turn result", () => {
    expect(extractTokenUsage({ type: "assistant" } as SDKMessage)).toBeNull();
  });

  it("survives a result with no usage block", () => {
    expect(extractTokenUsage({ type: "result" } as SDKMessage)).toBeNull();
  });
});

describe("conversation usage and provider", () => {
  let dir: string;
  let store: ConversationStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    store = createConversationStore({
      store: createStore({
        filePath: join(dir, STATE_FILE),
        debounceMs: FAST_DEBOUNCE_MS,
      }),
    });
  });

  afterEach(async () => {
    await store.flush();
    await rm(dir, { recursive: true, force: true });
  });

  it("accumulates usage across turns", () => {
    store.addTokenUsage(CONVERSATION_ID, {
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
    });
    store.addTokenUsage(CONVERSATION_ID, {
      inputTokens: 5,
      outputTokens: 3,
      totalTokens: 8,
    });
    expect(store.get(CONVERSATION_ID)?.tokenUsage).toEqual({
      inputTokens: 15,
      outputTokens: 5,
      totalTokens: 20,
    });
  });

  it("records which provider produced the transcript", () => {
    store.markProvider(CONVERSATION_ID, "codex");
    expect(store.get(CONVERSATION_ID)?.provider).toBe("codex");
    store.markProvider(CONVERSATION_ID, "claude");
    expect(store.get(CONVERSATION_ID)?.provider).toBe("claude");
  });
});
