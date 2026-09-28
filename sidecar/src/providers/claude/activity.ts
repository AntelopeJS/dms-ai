import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
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

interface SystemPayload {
  subtype?: string;
  status?: string | null;
  attempt?: number;
  max_retries?: number;
}

interface ToolProgressPayload {
  tool_name?: string;
}

type StreamActivityMapper = (payload: StreamEventPayload) => RunnerEvent[];

type SystemActivityMapper = (payload: SystemPayload) => RunnerEvent[];

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

function retryDetail(payload: SystemPayload): string {
  return CLAUDE_RETRY_DETAIL_TEMPLATE.replace(
    CLAUDE_RETRY_DETAIL_TOKENS.ATTEMPT,
    String(payload.attempt ?? ""),
  ).replace(CLAUDE_RETRY_DETAIL_TOKENS.MAX, String(payload.max_retries ?? ""));
}

function statusActivity(payload: SystemPayload): RunnerEvent[] {
  const kind = CLAUDE_STATUS_ACTIVITY[payload.status ?? ""];
  if (kind === undefined) return [];
  return [activity(kind)];
}

const SYSTEM_ACTIVITY_MAPPERS: Record<string, SystemActivityMapper> = {
  [CLAUDE_SYSTEM_SUBTYPES.STATUS]: statusActivity,
  [CLAUDE_SYSTEM_SUBTYPES.API_RETRY]: (payload) => [
    activity("retrying", retryDetail(payload)),
  ],
};

/** The activity a system message reveals: compaction, or a retried request. */
export function systemActivity(message: SDKMessage): RunnerEvent[] {
  const payload = message as SystemPayload;
  const mapper = SYSTEM_ACTIVITY_MAPPERS[payload.subtype ?? ""];
  if (mapper === undefined) return [];
  return mapper(payload);
}

/** A tool reporting that it is still running. */
export function toolProgressActivity(message: SDKMessage): RunnerEvent[] {
  return [activity("tool", (message as ToolProgressPayload).tool_name)];
}
