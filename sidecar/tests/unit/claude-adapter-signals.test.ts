import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import {
  CLAUDE_TERMINAL_REASON_MESSAGES,
  CLAUDE_TURN_FAILED_MESSAGE,
} from "../../src/constants/claude.js";
import { messageToEvents } from "../../src/providers/claude/adapter.js";

function eventsOf(message: unknown): RunnerEvent[] {
  return [...messageToEvents(message as SDKMessage)];
}

function streamEvent(event: unknown): unknown {
  return { type: "stream_event", parent_tool_use_id: null, event };
}

function result(fields: Record<string, unknown>): unknown {
  return { type: "result", subtype: "success", is_error: false, ...fields };
}

describe("claude adapter: activity with nothing to show yet", () => {
  it("reports a tool call being composed, with the tool's name", () => {
    const start = streamEvent({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Write" },
    });
    const delta = streamEvent({
      type: "content_block_delta",
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
      delta: { type: "thinking_delta", thinking: "Reading the mockup" },
    });
    const text = streamEvent({
      type: "content_block_delta",
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
    const compacting = {
      type: "system",
      subtype: "status",
      status: "compacting",
    };
    const retry = {
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      max_retries: 10,
    };
    const progress = { type: "tool_progress", tool_name: "Bash" };
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
    expect(eventsOf(result({ result: "Page ready." }))).toEqual([
      { type: "done" },
    ]);
  });

  it("explains a prompt that no longer fits in the context", () => {
    const tooLong = result({
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
    const apiError = result({
      is_error: true,
      result: "API Error: 529 Overloaded",
    });
    expect(eventsOf(apiError)).toEqual([
      { type: "error", message: "API Error: 529 Overloaded" },
      { type: "done" },
    ]);
  });

  it("keeps the first readable error of a failed execution", () => {
    const failed = result({
      subtype: "error_during_execution",
      is_error: true,
      errors: [
        "[ede_diagnostic] result_type=user stop_reason=null",
        "Error: tool crashed\n    at run (cli.js:1:1)",
      ],
    });
    const bare = result({ subtype: "error_max_budget_usd", is_error: true });
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
    const stopped = result({
      subtype: "error_during_execution",
      is_error: true,
      terminal_reason: "aborted_streaming",
      errors: ["[ede_diagnostic] result_type=user stop_reason=null"],
    });
    expect(eventsOf(stopped)).toEqual([{ type: "done" }]);
  });
});
