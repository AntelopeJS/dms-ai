import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  RunnerAssistantText,
  RunnerAssistantTextDelta,
  RunnerDone,
  RunnerEvent,
  RunnerToolResult,
  RunnerToolUse,
} from "../../agent/runner-events.js";
import type { TokenUsage } from "../../state/types.js";

const STREAM_DELTA_EVENT_TYPE = "content_block_delta";
const STREAM_TEXT_DELTA_TYPE = "text_delta";

interface AssistantContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface UserContentBlock {
  type: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface StreamEventDelta {
  type: string;
  text?: string;
}

interface StreamEventBlock {
  type: string;
  delta?: StreamEventDelta;
}

function extractAssistantBlocks(message: SDKMessage): AssistantContentBlock[] {
  if (message.type !== "assistant") return [];
  const content = (message.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content as AssistantContentBlock[];
}

function extractUserBlocks(message: SDKMessage): UserContentBlock[] {
  if (message.type !== "user") return [];
  const content = (message.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content as UserContentBlock[];
}

function extractStreamEvent(message: SDKMessage): StreamEventBlock | null {
  if (message.type !== "stream_event") return null;
  const event = (message as { event?: unknown }).event;
  if (!event || typeof event !== "object") return null;
  return event as StreamEventBlock;
}

function buildAssistantText(block: AssistantContentBlock): RunnerAssistantText {
  return { type: "assistant_text", text: block.text ?? "" };
}

function buildAssistantTextDelta(text: string): RunnerAssistantTextDelta {
  return { type: "assistant_text_delta", text };
}

function buildToolUse(block: AssistantContentBlock): RunnerToolUse {
  return {
    type: "tool_use",
    callId: block.id ?? "",
    toolName: block.name ?? "",
    args: block.input ?? null,
  };
}

function buildToolResult(block: UserContentBlock): RunnerToolResult {
  return {
    type: "tool_result",
    callId: block.tool_use_id ?? "",
    result: block.content ?? null,
    isError: block.is_error === true,
  };
}

type AssistantBlockMapper = (
  block: AssistantContentBlock,
) => RunnerEvent | undefined;

const ASSISTANT_BLOCK_MAPPERS: Record<string, AssistantBlockMapper> = {
  text: buildAssistantText,
  tool_use: buildToolUse,
};

type UserBlockMapper = (block: UserContentBlock) => RunnerEvent | undefined;

const USER_BLOCK_MAPPERS: Record<string, UserBlockMapper> = {
  tool_result: buildToolResult,
};

function* yieldAssistantEvents(
  message: SDKMessage,
): Generator<RunnerEvent, void> {
  for (const block of extractAssistantBlocks(message)) {
    const mapper = ASSISTANT_BLOCK_MAPPERS[block.type];
    if (mapper === undefined) continue;
    const event = mapper(block);
    if (event !== undefined) yield event;
  }
}

function* yieldUserEvents(message: SDKMessage): Generator<RunnerEvent, void> {
  for (const block of extractUserBlocks(message)) {
    const mapper = USER_BLOCK_MAPPERS[block.type];
    if (mapper === undefined) continue;
    const event = mapper(block);
    if (event !== undefined) yield event;
  }
}

function* yieldStreamEvents(message: SDKMessage): Generator<RunnerEvent, void> {
  const event = extractStreamEvent(message);
  if (event === null) return;
  if (event.type !== STREAM_DELTA_EVENT_TYPE) return;
  const delta = event.delta;
  if (delta === undefined || delta.type !== STREAM_TEXT_DELTA_TYPE) return;
  if (typeof delta.text !== "string" || delta.text.length === 0) return;
  yield buildAssistantTextDelta(delta.text);
}

function buildDone(): RunnerDone {
  return { type: "done" };
}

type MessageHandler = (message: SDKMessage) => Iterable<RunnerEvent>;

const MESSAGE_HANDLERS: Record<string, MessageHandler> = {
  assistant: yieldAssistantEvents,
  user: yieldUserEvents,
  stream_event: yieldStreamEvents,
  result: () => [buildDone()],
};

interface SdkUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

function sumInputTokens(usage: SdkUsage): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

/**
 * Tokens the turn cost, read off the SDK's terminal `result` message. Cached
 * and cache-write input both count: they are billed input, and Codex reports
 * them inside its own input figure too.
 */
export function extractTokenUsage(message: SDKMessage): TokenUsage | null {
  if (message.type !== "result") return null;
  const usage = (message as { usage?: unknown }).usage;
  if (usage === null || typeof usage !== "object") return null;
  const inputTokens = sumInputTokens(usage as SdkUsage);
  const outputTokens = (usage as SdkUsage).output_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function* messageToEvents(
  message: SDKMessage,
): Generator<RunnerEvent, void> {
  const handler = MESSAGE_HANDLERS[message.type];
  if (handler === undefined) return;
  for (const event of handler(message)) {
    yield event;
  }
}
