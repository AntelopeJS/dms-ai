import { z } from "zod";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "../constants/attachments.js";
import {
  CHATBOX_MODES,
  GENERATION_MODES,
  THINKING_LEVELS,
} from "../state/settings-types.js";
import { PROVIDER_NAMES } from "../state/types.js";

export const ROLES = ["iframe", "host"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE = { IFRAME: "iframe", HOST: "host" } as const;

export const MESSAGE_TYPES = {
  HELLO: "hello",
  ECHO: "echo",
  ECHO_REPLY: "echo_reply",
  USER_MESSAGE: "user_message",
  PERMISSION_RESPONSE: "permission_response",
  QUESTION_RESPONSE: "question_response",
  HOST_STATE_UPDATE: "host_state_update",
  HOST_NAVIGATION_COMPLETE: "host_navigation_complete",
  LIST_CONVERSATIONS: "list_conversations",
  DELETE_CONVERSATION: "delete_conversation",
  SET_SETTINGS: "set_settings",
  REQUEST_HOST_NAVIGATE: "request_host_navigate",
  INTERRUPT_TURN: "interrupt_turn",
  QUEUE_ENQUEUE: "queue_enqueue",
  QUEUE_CANCEL: "queue_cancel",
} as const;

// Upper bound on how many follow-ups a client may mirror; a guard against a
// rogue client parking unbounded base64 attachments in sidecar memory.
export const MAX_QUEUED_MESSAGES = 100;

export const PERMISSION_DECISION_VALUES = [
  "allow_once",
  "allow_session",
  "deny",
] as const;

export const ClientHelloMsg = z.object({
  type: z.literal(MESSAGE_TYPES.HELLO),
  role: z.enum(ROLES),
  conversationId: z.string().optional(),
});

export const EchoMsg = z.object({
  type: z.literal(MESSAGE_TYPES.ECHO),
  payload: z.string(),
});

export const ServerEchoReplyMsg = z.object({
  type: z.literal(MESSAGE_TYPES.ECHO_REPLY),
  payload: z.string(),
  serverTimeMs: z.number(),
});

// Base64 expands 3 raw bytes into 4 chars (plus padding); cap the encoded
// string itself so the declared `size` can't be spoofed low while `data`
// smuggles an arbitrarily large payload past validation.
const MAX_ATTACHMENT_BASE64_CHARS =
  Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4;

// A file the user attached to their message. `data` is the raw file bytes
// base64-encoded (no `data:` prefix); `size` is the pre-encoding byte length.
// Both are capped so a rogue client can't spend unbounded memory decoding it.
export const AttachmentSchema = z.object({
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(MAX_ATTACHMENT_BYTES),
  data: z.string().max(MAX_ATTACHMENT_BASE64_CHARS),
});

export const UserMessageMsg = z.object({
  type: z.literal(MESSAGE_TYPES.USER_MESSAGE),
  conversationId: z.string(),
  content: z.string(),
  attachments: z
    .array(AttachmentSchema)
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .optional(),
});

// A follow-up the user typed while a turn was running. The `id` is client-minted
// so cancels and echoes can reference it; attachment bytes are carried so the
// server-owned queue can run the turn without the client re-sending them.
export const QueuedItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  attachments: z
    .array(AttachmentSchema)
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .optional(),
});

// Iframe -> server: append one follow-up to the conversation's server-owned
// queue. The server is the sole owner: it stores, broadcasts QUEUE_STATE, and
// drives the dequeue, so the queue survives reconnects exactly-once.
export const QueueEnqueueMsg = z.object({
  type: z.literal(MESSAGE_TYPES.QUEUE_ENQUEUE),
  conversationId: z.string(),
  item: QueuedItemSchema,
});

// Iframe -> server: drop a not-yet-started follow-up from the server queue.
export const QueueCancelMsg = z.object({
  type: z.literal(MESSAGE_TYPES.QUEUE_CANCEL),
  conversationId: z.string(),
  id: z.string(),
});

export const PermissionResponseMsg = z.object({
  type: z.literal(MESSAGE_TYPES.PERMISSION_RESPONSE),
  conversationId: z.string(),
  requestId: z.string(),
  decision: z.enum(PERMISSION_DECISION_VALUES),
});

// Iframe -> server: the user's selected answers for an ASK_QUESTION request,
// aligned by index with the questions[] that were asked. Each entry is the
// chosen option label or free-text ("Other") answer.
export const QuestionResponseMsg = z.object({
  type: z.literal(MESSAGE_TYPES.QUESTION_RESPONSE),
  conversationId: z.string(),
  requestId: z.string(),
  answers: z.array(z.string()),
});

export const HostStateUpdateMsg = z.object({
  type: z.literal(MESSAGE_TYPES.HOST_STATE_UPDATE),
  currentPage: z.object({
    path: z.string(),
    filepath: z.string().optional(),
    title: z.string().optional(),
  }),
});

export const HostNavigationCompleteMsg = z.object({
  type: z.literal(MESSAGE_TYPES.HOST_NAVIGATION_COMPLETE),
  path: z.string(),
});

export const ListConversationsMsg = z.object({
  type: z.literal(MESSAGE_TYPES.LIST_CONVERSATIONS),
});

export const DeleteConversationMsg = z.object({
  type: z.literal(MESSAGE_TYPES.DELETE_CONVERSATION),
  conversationId: z.string(),
});

export const SetSettingsMsg = z.object({
  type: z.literal(MESSAGE_TYPES.SET_SETTINGS),
  // Optional rather than defaulted: an older chatbox that omits the field must
  // leave the stored provider alone, not silently reset it to the default.
  provider: z.enum(PROVIDER_NAMES).optional(),
  mode: z.enum(CHATBOX_MODES),
  thinking: z.enum(THINKING_LEVELS),
  generationMode: z.enum(GENERATION_MODES).default("safe"),
  allowLocalSkills: z.boolean().default(false),
});

// Sent by the iframe to ask the host DMS to navigate to a route (e.g. the
// settings page reached from the chatbox cogwheel). Bridged to the host as a
// HOST_COMMAND_NAVIGATE event.
export const RequestHostNavigateMsg = z.object({
  type: z.literal(MESSAGE_TYPES.REQUEST_HOST_NAVIGATE),
  path: z.string(),
});

// Sent by the iframe when the user hits Stop: gracefully interrupt the running
// turn (the SDK query) while keeping the conversation session alive.
export const InterruptTurnMsg = z.object({
  type: z.literal(MESSAGE_TYPES.INTERRUPT_TURN),
  conversationId: z.string(),
});

export const AnyClientMessage = z.discriminatedUnion("type", [
  ClientHelloMsg,
  EchoMsg,
  UserMessageMsg,
  PermissionResponseMsg,
  QuestionResponseMsg,
  HostStateUpdateMsg,
  HostNavigationCompleteMsg,
  ListConversationsMsg,
  DeleteConversationMsg,
  SetSettingsMsg,
  RequestHostNavigateMsg,
  InterruptTurnMsg,
  QueueEnqueueMsg,
  QueueCancelMsg,
]);
export type AnyClientMessageType = z.infer<typeof AnyClientMessage>;
export type ClientHelloMsgType = z.infer<typeof ClientHelloMsg>;
export type EchoMsgType = z.infer<typeof EchoMsg>;
export type ServerEchoReplyMsgType = z.infer<typeof ServerEchoReplyMsg>;
export type UserMessageMsgType = z.infer<typeof UserMessageMsg>;
export type AttachmentType = z.infer<typeof AttachmentSchema>;
export type PermissionResponseMsgType = z.infer<typeof PermissionResponseMsg>;
export type QuestionResponseMsgType = z.infer<typeof QuestionResponseMsg>;
export type HostStateUpdateMsgType = z.infer<typeof HostStateUpdateMsg>;
export type HostNavigationCompleteMsgType = z.infer<
  typeof HostNavigationCompleteMsg
>;
export type ListConversationsMsgType = z.infer<typeof ListConversationsMsg>;
export type DeleteConversationMsgType = z.infer<typeof DeleteConversationMsg>;
export type SetSettingsMsgType = z.infer<typeof SetSettingsMsg>;
export type RequestHostNavigateMsgType = z.infer<typeof RequestHostNavigateMsg>;
export type InterruptTurnMsgType = z.infer<typeof InterruptTurnMsg>;
export type QueuedItemType = z.infer<typeof QueuedItemSchema>;
export type QueueEnqueueMsgType = z.infer<typeof QueueEnqueueMsg>;
export type QueueCancelMsgType = z.infer<typeof QueueCancelMsg>;
