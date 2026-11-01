import type {
  SDKMessage,
  SDKPartialAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  RunnerAssistantTextDelta,
  RunnerEvent,
} from "../../agent/runner-events.js";
import {
  CLAUDE_STREAM_EVENT_TYPES,
  CLAUDE_TEXT_DELTA_TYPE,
} from "../../constants/claude.js";
import type { TokenUsage } from "../../state/types.js";
import {
  streamActivity,
  systemActivity,
  toolProgressActivity,
} from "./activity.js";
import { resultEvents } from "./result.js";

type StreamEvent = SDKPartialAssistantMessage["event"];

function buildAssistantTextDelta(text: string): RunnerAssistantTextDelta {
  return { type: "assistant_text_delta", text };
}

function* yieldAssistantEvents(
  message: SDKMessage,
): Generator<RunnerEvent, void> {
  if (message.type !== "assistant") return;
  const { content } = message.message;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block.type === "text") {
      yield { type: "assistant_text", text: block.text ?? "" };
    } else if (block.type === "tool_use") {
      yield {
        type: "tool_use",
        callId: block.id ?? "",
        toolName: block.name ?? "",
        args: block.input ?? null,
      };
    }
  }
}

function* yieldUserEvents(message: SDKMessage): Generator<RunnerEvent, void> {
  if (message.type !== "user") return;
  const { content } = message.message;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block.type !== "tool_result") continue;
    yield {
      type: "tool_result",
      callId: block.tool_use_id ?? "",
      result: block.content ?? null,
      isError: block.is_error === true,
    };
  }
}

function extractTextDelta(event: StreamEvent): string | null {
  if (event.type !== CLAUDE_STREAM_EVENT_TYPES.CONTENT_BLOCK_DELTA) return null;
  const { delta } = event;
  if (delta.type !== CLAUDE_TEXT_DELTA_TYPE) return null;
  if (delta.text.length === 0) return null;
  return delta.text;
}

function* yieldStreamEvents(message: SDKMessage): Generator<RunnerEvent, void> {
  if (message.type !== "stream_event") return;
  const text = extractTextDelta(message.event);
  if (text !== null) {
    yield buildAssistantTextDelta(text);
    return;
  }
  yield* streamActivity(message.event);
}

/**
 * Tokens the turn cost, read off the SDK's terminal `result` message. Cached
 * and cache-write input both count: they are billed input, and Codex reports
 * them inside its own input figure too.
 */
export function extractTokenUsage(message: SDKMessage): TokenUsage | null {
  if (message.type !== "result") return null;
  const { usage } = message;
  if (!usage) return null;
  const inputTokens =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  const outputTokens = usage.output_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function* messageToEvents(
  message: SDKMessage,
): Generator<RunnerEvent, void> {
  switch (message.type) {
    case "assistant":
      yield* yieldAssistantEvents(message);
      return;
    case "user":
      yield* yieldUserEvents(message);
      return;
    case "stream_event":
      yield* yieldStreamEvents(message);
      return;
    case "system":
      yield* systemActivity(message);
      return;
    case "tool_progress":
      yield* toolProgressActivity(message);
      return;
    case "result":
      yield* resultEvents(message);
      return;
    default:
      return;
  }
}
