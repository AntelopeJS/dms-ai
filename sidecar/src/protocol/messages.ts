import { z } from "zod";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "../constants/attachments.js";
import { FULL_AUTO_DURATIONS, RULE_KINDS } from "../constants/audit.js";
import {
  CHAT_MODES,
  CHECKPOINT_RETENTION_DAYS,
  GENERATION_MODES,
  REQUEST_TIMEOUT_MINUTES,
  THINKING_LEVELS,
} from "../state/settings-types.js";
import { PROVIDER_NAMES } from "../state/types.js";

export const ROLES = ["chat", "host"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE = { CHAT: "chat", HOST: "host" } as const;

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
  INTERRUPT_TURN: "interrupt_turn",
  QUEUE_ENQUEUE: "queue_enqueue",
  QUEUE_CANCEL: "queue_cancel",
  QUEUE_UPDATE: "queue_update",
  QUEUE_MOVE: "queue_move",
  QUEUE_CLEAR: "queue_clear",
  ACTOR: "actor",
  REVOKE_RULE: "revoke_rule",
  SET_CONVERSATION_MODE: "set_conversation_mode",
  LEAVE_CONVERSATION: "leave_conversation",
  STOP_AUTOFIX: "stop_autofix",
  RETRY_TURN: "retry_turn",
  CHANGE_SET_ACTION: "change_set_action",
} as const;

// Upper bound on how many follow-ups a client may mirror; a guard against a
// rogue client parking unbounded base64 attachments in sidecar memory.
export const MAX_QUEUED_MESSAGES = 100;

export const PERMISSION_DECISION_VALUES = [
  "allow_once",
  "allow_rule",
  "deny",
  "deny_all",
] as const;

// "Suggest a change": the user's words become the reason the agent reads.
export const MAX_DENIAL_FEEDBACK_CHARS = 2000;
const MAX_ACTOR_FIELD_CHARS = 200;

export const CHANGE_SET_ACTIONS = ["undo", "redo"] as const;

export const ClientHelloMsg = z.object({
  type: z.literal(MESSAGE_TYPES.HELLO),
  role: z.enum(ROLES),
  conversationId: z.string().optional(),
  // A chat that follows the conversation next to the one its socket shows
  // (the command palette's answer): the socket keeps receiving both.
  follow: z.boolean().optional(),
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
  // False when the user removed the page chip: the turn is sent without the
  // page it was typed on.
  includePageContext: z.boolean().optional(),
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
  includePageContext: z.boolean().optional(),
});

// Chat -> server: append one follow-up to the conversation's server-owned
// queue. The server is the sole owner: it stores, broadcasts QUEUE_STATE, and
// drives the dequeue, so the queue survives reconnects exactly-once.
export const QueueEnqueueMsg = z.object({
  type: z.literal(MESSAGE_TYPES.QUEUE_ENQUEUE),
  conversationId: z.string(),
  item: QueuedItemSchema,
});

// Chat -> server: drop a not-yet-started follow-up from the server queue.
export const QueueCancelMsg = z.object({
  type: z.literal(MESSAGE_TYPES.QUEUE_CANCEL),
  conversationId: z.string(),
  id: z.string(),
});

// Chat -> server: rewrite a not-yet-started follow-up.
export const QueueUpdateMsg = z.object({
  type: z.literal(MESSAGE_TYPES.QUEUE_UPDATE),
  conversationId: z.string(),
  id: z.string(),
  content: z.string(),
});

// Chat -> server: move a not-yet-started follow-up to another position.
export const QueueMoveMsg = z.object({
  type: z.literal(MESSAGE_TYPES.QUEUE_MOVE),
  conversationId: z.string(),
  id: z.string(),
  toIndex: z.number().int().nonnegative(),
});

// Chat -> server: drop every not-yet-started follow-up.
export const QueueClearMsg = z.object({
  type: z.literal(MESSAGE_TYPES.QUEUE_CLEAR),
  conversationId: z.string(),
});

/** A standing "allow" for one conversation, never for a whole tool. */
export const PermissionRuleSchema = z.object({
  kind: z.enum(RULE_KINDS),
  value: z.string().min(1),
});

export const PermissionResponseMsg = z.object({
  type: z.literal(MESSAGE_TYPES.PERMISSION_RESPONSE),
  conversationId: z.string(),
  requestId: z.string(),
  decision: z.enum(PERMISSION_DECISION_VALUES),
  // Required with allow_rule; must be one of the request's ruleOptions.
  rule: PermissionRuleSchema.optional(),
  feedback: z.string().max(MAX_DENIAL_FEEDBACK_CHARS).optional(),
  // With allow_once on BuilderDeleteResource: delete the code, keep the data.
  keepData: z.boolean().optional(),
});

export const RevokeRuleMsg = z.object({
  type: z.literal(MESSAGE_TYPES.REVOKE_RULE),
  conversationId: z.string(),
  ruleId: z.string(),
});

// Chat -> server: the user's selected answers for an ASK_QUESTION request,
// aligned by index with the questions[] that were asked. Each entry is the
// chosen option label or free-text ("Other") answer; `skipped[i]` marks a
// question the user left to the agent ("Skip, you decide").
export const QuestionResponseMsg = z.object({
  type: z.literal(MESSAGE_TYPES.QUESTION_RESPONSE),
  conversationId: z.string(),
  requestId: z.string(),
  answers: z.array(z.string()),
  skipped: z.array(z.boolean()).optional(),
});

/**
 * Who is driving this connection. Sent only by the backend bridge, right after
 * the socket opens; the bridge drops any browser frame of this type.
 */
export const ActorMsg = z.object({
  type: z.literal(MESSAGE_TYPES.ACTOR),
  userId: z.string().max(MAX_ACTOR_FIELD_CHARS),
  name: z.string().max(MAX_ACTOR_FIELD_CHARS),
});

export const FullAutoRequestSchema = z.object({
  duration: z.enum(FULL_AUTO_DURATIONS),
});

// Chat -> server: the conversation's own approval mode, scope and Full auto.
export const SetConversationModeMsg = z.object({
  type: z.literal(MESSAGE_TYPES.SET_CONVERSATION_MODE),
  conversationId: z.string(),
  mode: z.enum(CHAT_MODES).optional(),
  generationMode: z.enum(GENERATION_MODES).optional(),
  // `null` turns Full auto off.
  fullAuto: FullAutoRequestSchema.nullable().optional(),
});

// Chat -> server: the panel closed or another chat opened. Ends Full auto
// scoped to "until the chat closes".
export const LeaveConversationMsg = z.object({
  type: z.literal(MESSAGE_TYPES.LEAVE_CONVERSATION),
  conversationId: z.string(),
});

// Chat -> server: interrupt the running auto-fix turn and skip the rest.
export const StopAutoFixMsg = z.object({
  type: z.literal(MESSAGE_TYPES.STOP_AUTOFIX),
  conversationId: z.string(),
});

// Chat -> server: run the conversation's last user message again.
export const RetryTurnMsg = z.object({
  type: z.literal(MESSAGE_TYPES.RETRY_TURN),
  conversationId: z.string(),
});

export const ChangeSetActionMsg = z.object({
  type: z.literal(MESSAGE_TYPES.CHANGE_SET_ACTION),
  conversationId: z.string().optional(),
  changeSetId: z.string(),
  action: z.enum(CHANGE_SET_ACTIONS),
  includeLater: z.boolean().optional(),
});

export const HostStateUpdateMsg = z.object({
  type: z.literal(MESSAGE_TYPES.HOST_STATE_UPDATE),
  currentPage: z.object({
    path: z.string(),
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

// Every field optional: a settings change is merged over what is stored, so a
// client that omits a field leaves it alone rather than resetting it. `auto` is
// refused for `mode`: Full auto exists only per conversation.
export const SettingsPatchShape = {
  provider: z.enum(PROVIDER_NAMES).optional(),
  mode: z.enum(CHAT_MODES).optional(),
  thinking: z.enum(THINKING_LEVELS).optional(),
  generationMode: z.enum(GENERATION_MODES).optional(),
  allowLocalSkills: z.boolean().optional(),
  alwaysAskDependencies: z.boolean().optional(),
  alwaysAskBlockRemoval: z.boolean().optional(),
  requestTimeoutMinutes: z.literal(REQUEST_TIMEOUT_MINUTES).optional(),
  notifyRequests: z.boolean().optional(),
  checkpointRetentionDays: z.literal(CHECKPOINT_RETENTION_DAYS).optional(),
};

export const SettingsPatchSchema = z.object(SettingsPatchShape);

export const SetSettingsMsg = z.object({
  type: z.literal(MESSAGE_TYPES.SET_SETTINGS),
  ...SettingsPatchShape,
});

// Sent by the chat when the user hits Stop: gracefully interrupt the running
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
  InterruptTurnMsg,
  QueueEnqueueMsg,
  QueueCancelMsg,
  QueueUpdateMsg,
  QueueMoveMsg,
  QueueClearMsg,
  ActorMsg,
  RevokeRuleMsg,
  SetConversationModeMsg,
  LeaveConversationMsg,
  StopAutoFixMsg,
  RetryTurnMsg,
  ChangeSetActionMsg,
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
export type InterruptTurnMsgType = z.infer<typeof InterruptTurnMsg>;
export type QueuedItemType = z.infer<typeof QueuedItemSchema>;
export type QueueEnqueueMsgType = z.infer<typeof QueueEnqueueMsg>;
export type QueueCancelMsgType = z.infer<typeof QueueCancelMsg>;
export type PermissionRuleType = z.infer<typeof PermissionRuleSchema>;
export type SettingsPatchType = z.infer<typeof SettingsPatchSchema>;
export type SetConversationModeMsgType = z.infer<typeof SetConversationModeMsg>;
export type ChangeSetActionMsgType = z.infer<typeof ChangeSetActionMsg>;
export type PermissionDecisionValue =
  (typeof PERMISSION_DECISION_VALUES)[number];
