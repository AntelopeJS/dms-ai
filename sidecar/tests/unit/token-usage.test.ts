import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  NonNullableUsage,
  SDKMessage,
  SDKResultSuccess,
} from "@anthropic-ai/claude-agent-sdk";
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

const IDENTITY = {
  uuid: "00000000-0000-4000-8000-000000000000",
  session_id: "session-1",
} as const;

const EMPTY_USAGE: NonNullableUsage = {
  cache_creation: {
    ephemeral_1h_input_tokens: 0,
    ephemeral_5m_input_tokens: 0,
  },
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  inference_geo: "",
  input_tokens: 0,
  iterations: [],
  output_tokens: 0,
  server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
  service_tier: "standard",
  speed: "standard",
};

function resultMessage(usage: Partial<NonNullableUsage>): SDKResultSuccess {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 1,
    result: "",
    stop_reason: null,
    total_cost_usd: 0,
    usage: { ...EMPTY_USAGE, ...usage },
    modelUsage: {},
    permission_denials: [],
    ...IDENTITY,
  };
}

const NON_RESULT_MESSAGE: SDKMessage = {
  type: "tool_progress",
  tool_use_id: "tool-1",
  tool_name: "Bash",
  parent_tool_use_id: null,
  elapsed_time_seconds: 1,
  ...IDENTITY,
};

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
    expect(extractTokenUsage(NON_RESULT_MESSAGE)).toBeNull();
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
