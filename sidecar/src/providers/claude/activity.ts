import type {
  SDKAPIRetryMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKStatusMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ActivityKind,
  RunnerActivity,
  RunnerEvent,
} from "../../agent/runner-events.js";
import {
  CLAUDE_BLOCK_ACTIVITY,
  CLAUDE_DELTA_ACTIVITY,
  CLAUDE_RETRY_DETAIL_TEMPLATE,
  CLAUDE_RETRY_DETAIL_TOKENS,
  CLAUDE_STATUS_ACTIVITY,
  CLAUDE_STREAM_EVENT_TYPES,
  CLAUDE_SYSTEM_SUBTYPES,
} from "../../constants/claude.js";

type StreamEvent = SDKPartialAssistantMessage["event"];

function activity(kind: ActivityKind, detail?: string): RunnerActivity {
  if (detail === undefined || detail === "") return { type: "activity", kind };
  return { type: "activity", kind, detail };
}

/**
 * The activity a partial-message event reveals: the model starting a reply,
 * thinking, or composing a tool call. Text deltas are not activity, since they
 * already reach the chat as text.
 */
export function streamActivity(event: StreamEvent): RunnerEvent[] {
  switch (event.type) {
    case CLAUDE_STREAM_EVENT_TYPES.MESSAGE_START:
      return [activity("thinking")];
    case CLAUDE_STREAM_EVENT_TYPES.CONTENT_BLOCK_START: {
      const block = event.content_block;
      const kind = CLAUDE_BLOCK_ACTIVITY.get(block.type);
      if (kind === undefined) return [];
      return [activity(kind, "name" in block ? block.name : undefined)];
    }
    case CLAUDE_STREAM_EVENT_TYPES.CONTENT_BLOCK_DELTA: {
      const kind = CLAUDE_DELTA_ACTIVITY.get(event.delta.type);
      if (kind === undefined) return [];
      return [activity(kind)];
    }
    default:
      return [];
  }
}

function retryDetail(message: SDKAPIRetryMessage): string {
  return CLAUDE_RETRY_DETAIL_TEMPLATE.replace(
    CLAUDE_RETRY_DETAIL_TOKENS.ATTEMPT,
    String(message.attempt),
  ).replace(CLAUDE_RETRY_DETAIL_TOKENS.MAX, String(message.max_retries));
}

function statusActivity(message: SDKStatusMessage): RunnerEvent[] {
  const kind = CLAUDE_STATUS_ACTIVITY.get(message.status ?? "");
  if (kind === undefined) return [];
  return [activity(kind)];
}

/** The activity a system message reveals: compaction, or a retried request. */
export function systemActivity(message: SDKMessage): RunnerEvent[] {
  if (message.type !== "system") return [];
  switch (message.subtype) {
    case CLAUDE_SYSTEM_SUBTYPES.STATUS:
      return statusActivity(message);
    case CLAUDE_SYSTEM_SUBTYPES.API_RETRY:
      return [activity("retrying", retryDetail(message))];
    default:
      return [];
  }
}

/** A tool reporting that it is still running. */
export function toolProgressActivity(message: SDKMessage): RunnerEvent[] {
  if (message.type !== "tool_progress") return [];
  return [activity("tool", message.tool_name)];
}
