import type {
  NonNullableUsage,
  SDKAPIRetryMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultError,
  SDKResultSuccess,
  SDKStatusMessage,
  SDKToolProgressMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import {
  CLAUDE_TERMINAL_REASON_MESSAGES,
  CLAUDE_TURN_FAILED_MESSAGE,
} from "../../src/constants/claude.js";
import { messageToEvents } from "../../src/providers/claude/adapter.js";

const IDENTITY = {
  uuid: "00000000-0000-4000-8000-000000000000",
  session_id: "session-1",
} as const;

const USAGE: NonNullableUsage = {
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

const RESULT_BASE: Omit<SDKResultSuccess, "subtype" | "is_error" | "result"> = {
  type: "result",
  duration_ms: 0,
  duration_api_ms: 0,
  num_turns: 1,
  stop_reason: null,
  total_cost_usd: 0,
  usage: USAGE,
  modelUsage: {},
  permission_denials: [],
  ...IDENTITY,
};

function eventsOf(message: SDKMessage): RunnerEvent[] {
  return [...messageToEvents(message)];
}

function streamEvent(
  event: SDKPartialAssistantMessage["event"],
): SDKPartialAssistantMessage {
  return {
    type: "stream_event",
    parent_tool_use_id: null,
    event,
    ...IDENTITY,
  };
}

function success(fields: Partial<SDKResultSuccess>): SDKResultSuccess {
  return {
    ...RESULT_BASE,
    subtype: "success",
    is_error: false,
    result: "",
    ...fields,
  };
}

function failure(fields: Partial<SDKResultError>): SDKResultError {
  return {
    ...RESULT_BASE,
    subtype: "error_during_execution",
    is_error: true,
    errors: [],
    ...fields,
  };
}

describe("claude adapter: activity with nothing to show yet", () => {
  it("reports a tool call being composed, with the tool's name", () => {
    const start = streamEvent({
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "tool-1",
        name: "Write",
        input: {},
      },
    });
    const delta = streamEvent({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"content":' },
    });
    expect(eventsOf(start)).toEqual([
      { type: "activity", kind: "writing", detail: "Write" },
    ]);
    expect(eventsOf(delta)).toEqual([{ type: "activity", kind: "writing" }]);
  });

  it("reports thinking, and keeps text deltas as text", () => {
    const thinking = streamEvent({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "Reading the mockup" },
    });
    const text = streamEvent({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Done." },
    });
    expect(eventsOf(thinking)).toEqual([
      { type: "activity", kind: "thinking" },
    ]);
    expect(eventsOf(text)).toEqual([
      { type: "assistant_text_delta", text: "Done." },
    ]);
  });

  it("reports compaction, retried requests and a running tool", () => {
    const compacting: SDKStatusMessage = {
      type: "system",
      subtype: "status",
      status: "compacting",
      ...IDENTITY,
    };
    const retry: SDKAPIRetryMessage = {
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      max_retries: 10,
      retry_delay_ms: 1000,
      error_status: null,
      error: "server_error",
      ...IDENTITY,
    };
    const progress: SDKToolProgressMessage = {
      type: "tool_progress",
      tool_use_id: "tool-1",
      tool_name: "Bash",
      parent_tool_use_id: null,
      elapsed_time_seconds: 1,
      ...IDENTITY,
    };
    expect(eventsOf(compacting)).toEqual([
      { type: "activity", kind: "compacting" },
    ]);
    expect(eventsOf(retry)).toEqual([
      { type: "activity", kind: "retrying", detail: "attempt 2 of 10" },
    ]);
    expect(eventsOf(progress)).toEqual([
      { type: "activity", kind: "tool", detail: "Bash" },
    ]);
  });
});

describe("claude adapter: how a turn ends", () => {
  it("ends a successful turn with done alone", () => {
    expect(eventsOf(success({ result: "Page ready." }))).toEqual([
      { type: "done" },
    ]);
  });

  it("explains a prompt that no longer fits in the context", () => {
    const tooLong = success({
      is_error: true,
      result: "Prompt is too long",
      terminal_reason: "prompt_too_long",
    });
    expect(eventsOf(tooLong)).toEqual([
      {
        type: "error",
        message: CLAUDE_TERMINAL_REASON_MESSAGES.prompt_too_long,
        isRetryable: false,
      },
      { type: "done" },
    ]);
  });

  it("passes on the API's own wording for a failed request", () => {
    const apiError = success({
      is_error: true,
      result: "API Error: 529 Overloaded",
    });
    expect(eventsOf(apiError)).toEqual([
      { type: "error", message: "API Error: 529 Overloaded" },
      { type: "done" },
    ]);
  });

  it("keeps the first readable error of a failed execution", () => {
    const failed = failure({
      errors: [
        "[ede_diagnostic] result_type=user stop_reason=null",
        "Error: tool crashed\n    at run (cli.js:1:1)",
      ],
    });
    const bare = failure({ subtype: "error_max_budget_usd" });
    expect(eventsOf(failed)[0]).toEqual({
      type: "error",
      message: "Error: tool crashed",
    });
    expect(eventsOf(bare)[0]).toEqual({
      type: "error",
      message: CLAUDE_TURN_FAILED_MESSAGE,
    });
  });

  it("does not report a turn the user stopped as a failure", () => {
    const stopped = failure({
      terminal_reason: "aborted_streaming",
      errors: ["[ede_diagnostic] result_type=user stop_reason=null"],
    });
    expect(eventsOf(stopped)).toEqual([{ type: "done" }]);
  });
});
