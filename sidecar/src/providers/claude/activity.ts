import type {
  SDKAPIRetryMessage,
  SDKMessage,
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

interface StreamContentBlock {
  type?: string;
  name?: string;
}

interface StreamDelta {
  type?: string;
}

interface StreamEventPayload {
  type?: string;
  content_block?: StreamContentBlock;
  delta?: StreamDelta;
}

type ActivitySystemMessage = SDKStatusMessage | SDKAPIRetryMessage;

type ActivitySystemSubtype = ActivitySystemMessage["subtype"];

type SystemActivityMappers = {
  [Subtype in ActivitySystemSubtype]: (
    message: Extract<ActivitySystemMessage, { subtype: Subtype }>,
  ) => RunnerEvent[];
};

type SystemActivityMapper = (message: ActivitySystemMessage) => RunnerEvent[];

type StreamActivityMapper = (payload: StreamEventPayload) => RunnerEvent[];

function activity(kind: ActivityKind, detail?: string): RunnerActivity {
  if (detail === undefined || detail === "") return { type: "activity", kind };
  return { type: "activity", kind, detail };
}

function blockStartActivity(payload: StreamEventPayload): RunnerEvent[] {
  const block = payload.content_block;
  const kind = CLAUDE_BLOCK_ACTIVITY[block?.type ?? ""];
  if (kind === undefined) return [];
  return [activity(kind, block?.name)];
}

function deltaActivity(payload: StreamEventPayload): RunnerEvent[] {
  const kind = CLAUDE_DELTA_ACTIVITY[payload.delta?.type ?? ""];
  if (kind === undefined) return [];
  return [activity(kind)];
}

const STREAM_ACTIVITY_MAPPERS: Record<string, StreamActivityMapper> = {
  [CLAUDE_STREAM_EVENT_TYPES.MESSAGE_START]: () => [activity("thinking")],
  [CLAUDE_STREAM_EVENT_TYPES.CONTENT_BLOCK_START]: blockStartActivity,
  [CLAUDE_STREAM_EVENT_TYPES.CONTENT_BLOCK_DELTA]: deltaActivity,
};

/**
 * The activity a partial-message event reveals: the model starting a reply,
 * thinking, or composing a tool call. Text deltas are not activity, since they
 * already reach the chat as text.
 */
export function streamActivity(event: unknown): RunnerEvent[] {
  if (event === null || typeof event !== "object") return [];
  const payload = event as StreamEventPayload;
  const mapper = STREAM_ACTIVITY_MAPPERS[payload.type ?? ""];
  if (mapper === undefined) return [];
  return mapper(payload);
}

function retryDetail(message: SDKAPIRetryMessage): string {
  return CLAUDE_RETRY_DETAIL_TEMPLATE.replace(
    CLAUDE_RETRY_DETAIL_TOKENS.ATTEMPT,
    String(message.attempt),
  ).replace(CLAUDE_RETRY_DETAIL_TOKENS.MAX, String(message.max_retries));
}

function statusActivity(message: SDKStatusMessage): RunnerEvent[] {
  const kind = CLAUDE_STATUS_ACTIVITY[message.status ?? ""];
  if (kind === undefined) return [];
  return [activity(kind)];
}

const SYSTEM_ACTIVITY_MAPPERS: SystemActivityMappers = {
  [CLAUDE_SYSTEM_SUBTYPES.STATUS]: statusActivity,
  [CLAUDE_SYSTEM_SUBTYPES.API_RETRY]: (message) => [
    activity("retrying", retryDetail(message)),
  ],
};

function isActivitySystemMessage(
  message: SDKMessage,
): message is ActivitySystemMessage {
  return (
    message.type === "system" && message.subtype in SYSTEM_ACTIVITY_MAPPERS
  );
}

/** The activity a system message reveals: compaction, or a retried request. */
export function systemActivity(message: SDKMessage): RunnerEvent[] {
  if (!isActivitySystemMessage(message)) return [];
  const mapper: SystemActivityMapper = SYSTEM_ACTIVITY_MAPPERS[
    message.subtype
  ] as SystemActivityMapper;
  return mapper(message);
}

/** A tool reporting that it is still running. */
export function toolProgressActivity(message: SDKMessage): RunnerEvent[] {
  if (message.type !== "tool_progress") return [];
  return [activity("tool", message.tool_name)];
}
