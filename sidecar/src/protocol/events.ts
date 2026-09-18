import { z } from "zod";
import {
  CHATBOX_MODES,
  GENERATION_MODES,
  THINKING_LEVELS,
} from "../state/settings-types.js";
import { PROVIDER_NAMES } from "../state/types.js";
import { QueuedItemSchema } from "./messages.js";

export const EVENT_TYPES = {
  ASSISTANT_MESSAGE_CHUNK: "assistant_message_chunk",
  TOOL_CALL_START: "tool_call_start",
  TOOL_CALL_END: "tool_call_end",
  RUN_DONE: "run_done",
  RUN_ERROR: "run_error",
  RUN_RESUMED: "run_resumed",
  CONVERSATION_SNAPSHOT: "conversation_snapshot",
  CONVERSATION_LIST: "conversation_list",
  SETTINGS_UPDATE: "settings_update",
  PERMISSION_REQUEST: "permission_request",
  ASK_QUESTION: "ask_question",
  HOST_COMMAND_NAVIGATE: "host_command_navigate",
  QUEUE_STATE: "queue_state",
  USER_MESSAGE_ECHO: "user_message_echo",
} as const;

export const STATUS = {
  SUCCESS: "success",
  ERROR: "error",
} as const;

export const STATUS_VALUES = [STATUS.SUCCESS, STATUS.ERROR] as const;

export const AssistantMessageChunkEvent = z.object({
  type: z.literal(EVENT_TYPES.ASSISTANT_MESSAGE_CHUNK),
  conversationId: z.string(),
  text: z.string(),
});

export const ToolCallStartEvent = z.object({
  type: z.literal(EVENT_TYPES.TOOL_CALL_START),
  conversationId: z.string(),
  callId: z.string(),
  toolName: z.string(),
  args: z.unknown(),
});

export const ToolCallEndEvent = z.object({
  type: z.literal(EVENT_TYPES.TOOL_CALL_END),
  conversationId: z.string(),
  callId: z.string(),
  status: z.enum(STATUS_VALUES),
  result: z.unknown(),
});

export const RunDoneEvent = z.object({
  type: z.literal(EVENT_TYPES.RUN_DONE),
  conversationId: z.string(),
});

export const RunErrorEvent = z.object({
  type: z.literal(EVENT_TYPES.RUN_ERROR),
  conversationId: z.string(),
  error: z.string(),
});

export const RunResumedEvent = z.object({
  type: z.literal(EVENT_TYPES.RUN_RESUMED),
  conversationId: z.string(),
});

export const SnapshotAttachmentMeta = z.object({
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
});

export const ConversationSnapshotMessage = z.object({
  role: z.string(),
  content: z.string(),
  toolName: z.string().optional(),
  callId: z.string().optional(),
  status: z.string().optional(),
  attachments: z.array(SnapshotAttachmentMeta).optional(),
  timestampMs: z.number(),
});

export const ConversationSnapshotEvent = z.object({
  type: z.literal(EVENT_TYPES.CONVERSATION_SNAPSHOT),
  conversationId: z.string(),
  messages: z.array(ConversationSnapshotMessage),
});

export const ConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAtMs: z.number(),
  updatedAtMs: z.number(),
  messageCount: z.number(),
});

export const ConversationListEvent = z.object({
  type: z.literal(EVENT_TYPES.CONVERSATION_LIST),
  conversations: z.array(ConversationSummarySchema),
});

export const AppSettingsSchema = z.object({
  // Optional rather than defaulted: an older client that omits the field must
  // leave the stored provider alone, not silently reset it to the default.
  provider: z.enum(PROVIDER_NAMES).optional(),
  mode: z.enum(CHATBOX_MODES),
  thinking: z.enum(THINKING_LEVELS),
  // Older persisted payloads / clients omit this; safe is the product default,
  // and it self-downgrades to vibe when the Builder is absent.
  generationMode: z.enum(GENERATION_MODES).default("safe"),
  // Older persisted payloads / clients omit this; default off preserves the
  // reproducible-by-default posture.
  allowLocalSkills: z.boolean().default(false),
});

export const ProviderAvailabilitySchema = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
});

// Read-only capability, like builderAvailable: which backends this install can
// actually drive, so a frontend greys out the ones it cannot offer.
export const ProviderAvailabilityMapSchema = z.record(
  z.enum(PROVIDER_NAMES),
  ProviderAvailabilitySchema,
);

export const SettingsUpdateEvent = z.object({
  type: z.literal(EVENT_TYPES.SETTINGS_UPDATE),
  settings: AppSettingsSchema,
  // Read-only capability: whether the Builder interface is present, gating the
  // safe-mode toggle in both frontends. Not a persisted setting.
  builderAvailable: z.boolean().default(false),
  providers: ProviderAvailabilityMapSchema.optional(),
});

export const PermissionRequestEvent = z.object({
  type: z.literal(EVENT_TYPES.PERMISSION_REQUEST),
  conversationId: z.string(),
  requestId: z.string(),
  toolName: z.string(),
  args: z.unknown(),
  summary: z.string(),
});

// One selectable answer to a question. Mirrors the SDK's AskUserQuestion option
// shape (label/description, plus an optional preview blob).
export const QuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
  preview: z.string().optional(),
});

// A single question with its choices. Mirrors AskUserQuestionInput's per-question
// shape (2-4 distinct options; an "Other" free-text answer is always offered by
// the UI, so it is not encoded here).
export const QuestionSchema = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(QuestionOptionSchema).min(2).max(4),
});

// Server -> iframe: ask the user to pick answers. Mirrors the permission request
// round-trip; answered by a QUESTION_RESPONSE keyed by requestId.
export const AskQuestionEvent = z.object({
  type: z.literal(EVENT_TYPES.ASK_QUESTION),
  conversationId: z.string(),
  requestId: z.string(),
  questions: z.array(QuestionSchema).min(1).max(4),
});

export const HostCommandNavigateEvent = z.object({
  type: z.literal(EVENT_TYPES.HOST_COMMAND_NAVIGATE),
  path: z.string(),
});

// Server -> iframe: the conversation's server-owned follow-up queue, broadcast
// on every queue change and on re-attach. It is the single source of truth for
// the client's pending-queue display.
export const QueueStateEvent = z.object({
  type: z.literal(EVENT_TYPES.QUEUE_STATE),
  conversationId: z.string(),
  items: z.array(QueuedItemSchema),
});

// Server -> iframe: a queued follow-up the server just dequeued and is about to
// run. The client renders the user bubble at this point (it did not echo the
// item locally, since the server owns the queue). Attachments are metadata only.
export const UserMessageEchoEvent = z.object({
  type: z.literal(EVENT_TYPES.USER_MESSAGE_ECHO),
  conversationId: z.string(),
  content: z.string(),
  attachments: z.array(SnapshotAttachmentMeta).optional(),
  timestampMs: z.number(),
});

export const AnyServerEvent = z.discriminatedUnion("type", [
  AssistantMessageChunkEvent,
  ToolCallStartEvent,
  ToolCallEndEvent,
  RunDoneEvent,
  RunErrorEvent,
  RunResumedEvent,
  ConversationSnapshotEvent,
  ConversationListEvent,
  SettingsUpdateEvent,
  PermissionRequestEvent,
  AskQuestionEvent,
  HostCommandNavigateEvent,
  QueueStateEvent,
  UserMessageEchoEvent,
]);
export type AnyServerEventType = z.infer<typeof AnyServerEvent>;
export type RunResumedEventType = z.infer<typeof RunResumedEvent>;
export type ConversationSnapshotEventType = z.infer<
  typeof ConversationSnapshotEvent
>;
export type ConversationListEventType = z.infer<typeof ConversationListEvent>;
export type SettingsUpdateEventType = z.infer<typeof SettingsUpdateEvent>;
export type PermissionRequestEventType = z.infer<typeof PermissionRequestEvent>;
export type QuestionType = z.infer<typeof QuestionSchema>;
export type AskQuestionEventType = z.infer<typeof AskQuestionEvent>;
export type QueueStateEventType = z.infer<typeof QueueStateEvent>;
export type UserMessageEchoEventType = z.infer<typeof UserMessageEchoEvent>;
