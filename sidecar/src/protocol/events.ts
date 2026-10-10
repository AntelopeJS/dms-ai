import { z } from "zod";
import { ACTIVITY_KINDS } from "../constants/agent.js";
import {
  ALLOWED_BY_VALUES,
  CHANGE_FILE_STATUSES,
  CHANGE_SET_STATES,
  FULL_AUTO_DURATIONS,
  PERMISSION_KINDS,
  RULE_KINDS,
  TOOL_OUTCOMES,
  TYPECHECK_OUTCOMES,
} from "../constants/audit.js";
import { DEFAULT_SETTINGS } from "../constants/settings.js";
import {
  CHAT_MODES,
  CHECKPOINT_RETENTION_DAYS,
  GENERATION_MODES,
  REQUEST_TIMEOUT_MINUTES,
  THINKING_LEVELS,
} from "../state/settings-types.js";
import { PROVIDER_NAMES } from "../state/types.js";
import {
  PERMISSION_DECISION_VALUES,
  PermissionRuleSchema,
  QueuedItemSchema,
} from "./messages.js";

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
  RUN_PROGRESS: "run_progress",
  PERMISSION_EXPIRED: "permission_expired",
  PERMISSION_RESOLVED: "permission_resolved",
  RULES_STATE: "rules_state",
  QUESTION_EXPIRED: "question_expired",
  CONVERSATION_MODE: "conversation_mode",
  NOTICE: "notice",
  CHANGE_SET: "change_set",
  USAGE: "usage",
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

export const ToolOutcomeSchema = z.enum(TOOL_OUTCOMES);
export const AllowedBySchema = z.enum(ALLOWED_BY_VALUES);

export const ToolCallEndEvent = z.object({
  type: z.literal(EVENT_TYPES.TOOL_CALL_END),
  conversationId: z.string(),
  callId: z.string(),
  status: z.enum(STATUS_VALUES),
  result: z.unknown(),
  outcome: ToolOutcomeSchema,
  allowedBy: AllowedBySchema.optional(),
  changeSetId: z.string().optional(),
});

export const RunDoneEvent = z.object({
  type: z.literal(EVENT_TYPES.RUN_DONE),
  conversationId: z.string(),
});

export const RunErrorEvent = z.object({
  type: z.literal(EVENT_TYPES.RUN_ERROR),
  conversationId: z.string(),
  error: z.string(),
  isRetryable: z.boolean().optional(),
});

export const RunResumedEvent = z.object({
  type: z.literal(EVENT_TYPES.RUN_RESUMED),
  conversationId: z.string(),
});

/**
 * Server -> chat: what a running turn is doing, sent when its activity
 * changes and as a heartbeat. `elapsedMs` counts from the turn start and
 * `idleMs` from the agent's last activity, so the chat can tell a working
 * turn from a quiet one, and a live connection from a dead one.
 */
export const RunProgressEvent = z.object({
  type: z.literal(EVENT_TYPES.RUN_PROGRESS),
  conversationId: z.string(),
  activity: z.enum(ACTIVITY_KINDS),
  detail: z.string().optional(),
  elapsedMs: z.number(),
  idleMs: z.number(),
});

export const SnapshotAttachmentMeta = z.object({
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
});

export const AutoFixNoticeSchema = z.object({
  kind: z.literal("autofix"),
  attempt: z.number(),
  maxAttempts: z.number(),
  errors: z.array(z.string()),
  timestampMs: z.number(),
});

export const PermissionExpiredNoticeSchema = z.object({
  kind: z.literal("permission_expired"),
  toolName: z.string(),
  summary: z.string(),
  timestampMs: z.number(),
});

export const QuestionSkippedNoticeSchema = z.object({
  kind: z.literal("question_skipped"),
  header: z.string(),
  timestampMs: z.number(),
});

export const FullAutoEndedNoticeSchema = z.object({
  kind: z.literal("full_auto_ended"),
  timestampMs: z.number(),
});

export const NoticeSchema = z.discriminatedUnion("kind", [
  AutoFixNoticeSchema,
  PermissionExpiredNoticeSchema,
  QuestionSkippedNoticeSchema,
  FullAutoEndedNoticeSchema,
]);

export const QuestionAnswerRecordSchema = z.object({
  header: z.string(),
  question: z.string(),
  answer: z.string().nullable(),
  skipped: z.boolean(),
  isCustom: z.boolean(),
});

// Roles: user | assistant | tool_use | tool_result | error | notice |
// change_set | question_answer. A `change_set` entry carries only its id; the
// summary is in the snapshot's changeSets list.
export const ConversationSnapshotMessage = z.object({
  role: z.string(),
  content: z.string(),
  toolName: z.string().optional(),
  callId: z.string().optional(),
  status: z.string().optional(),
  attachments: z.array(SnapshotAttachmentMeta).optional(),
  isRetryable: z.boolean().optional(),
  timestampMs: z.number(),
  outcome: ToolOutcomeSchema.optional(),
  allowedBy: AllowedBySchema.optional(),
  changeSetId: z.string().optional(),
  notice: NoticeSchema.optional(),
  answers: z.array(QuestionAnswerRecordSchema).optional(),
  isAutoFix: z.boolean().optional(),
});

export const ChangeSetFileSchema = z.object({
  path: z.string(),
  status: z.enum(CHANGE_FILE_STATUSES),
  added: z.number(),
  removed: z.number(),
});

export const ChangeSetSummarySchema = z.object({
  id: z.string(),
  number: z.number(),
  conversationId: z.string(),
  title: z.string(),
  createdAtMs: z.number(),
  agent: z.enum(PROVIDER_NAMES),
  scope: z.enum(GENERATION_MODES),
  isAutoFix: z.boolean(),
  overlapped: z.boolean(),
  files: z.array(ChangeSetFileSchema),
  added: z.number(),
  removed: z.number(),
  typecheck: z.enum(TYPECHECK_OUTCOMES),
  state: z.enum(CHANGE_SET_STATES),
  stateChangedAtMs: z.number().optional(),
  stateChangedBy: z.string().optional(),
  askedBy: z.string().optional(),
  approvalsNeeded: z.number(),
  builderOps: z.number(),
});

export const FullAutoStateSchema = z.object({
  duration: z.enum(FULL_AUTO_DURATIONS),
  untilMs: z.number().optional(),
});

export const ConversationModeSchema = z.object({
  conversationId: z.string(),
  mode: z.enum(CHAT_MODES),
  // Effective: vibe when the Builder is absent.
  generationMode: z.enum(GENERATION_MODES),
  fullAuto: FullAutoStateSchema.nullable(),
});

export const ConversationModeEvent = ConversationModeSchema.extend({
  type: z.literal(EVENT_TYPES.CONVERSATION_MODE),
});

export const ConversationSnapshotEvent = z.object({
  type: z.literal(EVENT_TYPES.CONVERSATION_SNAPSHOT),
  conversationId: z.string(),
  messages: z.array(ConversationSnapshotMessage),
  changeSets: z.array(ChangeSetSummarySchema),
  mode: ConversationModeSchema,
  totalTokens: z.number(),
});

export const ConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAtMs: z.number(),
  updatedAtMs: z.number(),
  messageCount: z.number(),
  provider: z.enum(PROVIDER_NAMES).optional(),
  totalTokens: z.number(),
  filesChanged: z.number(),
  isRunning: z.boolean(),
  pendingApprovals: z.number(),
  pendingQuestions: z.number(),
  generationMode: z.enum(GENERATION_MODES),
});

export const ConversationListEvent = z.object({
  type: z.literal(EVENT_TYPES.CONVERSATION_LIST),
  conversations: z.array(ConversationSummarySchema),
});

export const AppSettingsSchema = z.object({
  // Optional rather than defaulted: an older client that omits the field must
  // leave the stored provider alone, not silently reset it to the default.
  provider: z.enum(PROVIDER_NAMES).optional(),
  mode: z.enum(CHAT_MODES),
  thinking: z.enum(THINKING_LEVELS),
  // Older persisted payloads / clients omit this; safe is the product default,
  // and it self-downgrades to vibe when the Builder is absent.
  generationMode: z.enum(GENERATION_MODES).default("safe"),
  // Older persisted payloads / clients omit this; default off preserves the
  // reproducible-by-default posture.
  allowLocalSkills: z.boolean().default(false),
  alwaysAskDependencies: z
    .boolean()
    .default(DEFAULT_SETTINGS.alwaysAskDependencies),
  alwaysAskBlockRemoval: z
    .boolean()
    .default(DEFAULT_SETTINGS.alwaysAskBlockRemoval),
  requestTimeoutMinutes: z
    .literal(REQUEST_TIMEOUT_MINUTES)
    .default(DEFAULT_SETTINGS.requestTimeoutMinutes),
  notifyRequests: z.boolean().default(DEFAULT_SETTINGS.notifyRequests),
  checkpointRetentionDays: z
    .literal(CHECKPOINT_RETENTION_DAYS)
    .default(DEFAULT_SETTINGS.checkpointRetentionDays),
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

export const DiffLineSchema = z.object({
  kind: z.enum(["context", "add", "remove"]),
  text: z.string(),
  oldLine: z.number().optional(),
  newLine: z.number().optional(),
});

export const DiffHunkSchema = z.object({
  oldStart: z.number(),
  newStart: z.number(),
  lines: z.array(DiffLineSchema),
});

export const DiffPreviewSchema = z.object({
  type: z.literal("diff"),
  path: z.string(),
  relativePath: z.string(),
  isNewFile: z.boolean(),
  added: z.number(),
  removed: z.number(),
  hunks: z.array(DiffHunkSchema),
});

export const CommandPreviewSchema = z.object({
  type: z.literal("command"),
  command: z.string(),
  cwd: z.string(),
  effect: z.enum(["adds_dependency", "removes_dependency"]).optional(),
  touches: z.array(z.string()).optional(),
});

export const DestructivePreviewSchema = z.object({
  type: z.literal("destructive"),
  operation: z.string(),
  target: z.string(),
  consequence: z.enum(["deletes_data", "removes_code"]),
  confirmText: z.string().optional(),
  canKeepData: z.boolean(),
});

export const WebPreviewSchema = z.object({
  type: z.literal("web"),
  url: z.string(),
  host: z.string(),
});

export const GenericPreviewSchema = z.object({
  type: z.literal("generic"),
  args: z.record(z.string(), z.unknown()),
});

export const PermissionPreviewSchema = z.discriminatedUnion("type", [
  DiffPreviewSchema,
  CommandPreviewSchema,
  DestructivePreviewSchema,
  WebPreviewSchema,
  GenericPreviewSchema,
]);

export const PermissionRequestEvent = z.object({
  type: z.literal(EVENT_TYPES.PERMISSION_REQUEST),
  conversationId: z.string(),
  requestId: z.string(),
  callId: z.string().optional(),
  toolName: z.string(),
  args: z.unknown(),
  summary: z.string(),
  kind: z.enum(PERMISSION_KINDS),
  // Deletions and the always-ask set: no rule offered, never auto-approved.
  alwaysAsk: z.boolean(),
  preview: PermissionPreviewSchema,
  // Scopes the card may offer, narrowest first; [] = only this time.
  ruleOptions: z.array(PermissionRuleSchema),
  createdAtMs: z.number(),
  expiresAtMs: z.number(),
});

export const PermissionExpiredEvent = z.object({
  type: z.literal(EVENT_TYPES.PERMISSION_EXPIRED),
  conversationId: z.string(),
  requestId: z.string(),
  toolName: z.string(),
  summary: z.string(),
  expiredAtMs: z.number(),
});

// Another tab (or deny_all) answered the request: drop its card.
export const PermissionResolvedEvent = z.object({
  type: z.literal(EVENT_TYPES.PERMISSION_RESOLVED),
  conversationId: z.string(),
  requestId: z.string(),
  decision: z.enum([...PERMISSION_DECISION_VALUES, "expired"]),
});

export const ActiveRuleSchema = z.object({
  id: z.string(),
  kind: z.enum(RULE_KINDS),
  value: z.string(),
  label: z.string(),
  createdAtMs: z.number(),
});

export const RulesStateEvent = z.object({
  type: z.literal(EVENT_TYPES.RULES_STATE),
  conversationId: z.string(),
  rules: z.array(ActiveRuleSchema),
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

// Server -> chat: ask the user to pick answers. Mirrors the permission request
// round-trip; answered by a QUESTION_RESPONSE keyed by requestId.
export const AskQuestionEvent = z.object({
  type: z.literal(EVENT_TYPES.ASK_QUESTION),
  conversationId: z.string(),
  requestId: z.string(),
  questions: z.array(QuestionSchema).min(1).max(4),
  createdAtMs: z.number(),
  expiresAtMs: z.number(),
});

export const QuestionExpiredEvent = z.object({
  type: z.literal(EVENT_TYPES.QUESTION_EXPIRED),
  conversationId: z.string(),
  requestId: z.string(),
});

export const NoticeEvent = z.object({
  type: z.literal(EVENT_TYPES.NOTICE),
  conversationId: z.string(),
  notice: NoticeSchema,
});

// A turn's change set was recorded, or its state changed (undone / redone).
export const ChangeSetEvent = z.object({
  type: z.literal(EVENT_TYPES.CHANGE_SET),
  conversationId: z.string(),
  changeSet: ChangeSetSummarySchema,
});

// After each turn: the running token total of the chat.
export const UsageEvent = z.object({
  type: z.literal(EVENT_TYPES.USAGE),
  conversationId: z.string(),
  totalTokens: z.number(),
});

export const HostCommandNavigateEvent = z.object({
  type: z.literal(EVENT_TYPES.HOST_COMMAND_NAVIGATE),
  path: z.string(),
});

// Server -> chat: the conversation's server-owned follow-up queue, broadcast
// on every queue change and on re-attach. It is the single source of truth for
// the client's pending-queue display.
export const QueueStateEvent = z.object({
  type: z.literal(EVENT_TYPES.QUEUE_STATE),
  conversationId: z.string(),
  items: z.array(QueuedItemSchema),
});

// Server -> chat: a queued follow-up the server just dequeued and is about to
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
  RunProgressEvent,
  ConversationSnapshotEvent,
  ConversationListEvent,
  SettingsUpdateEvent,
  PermissionRequestEvent,
  AskQuestionEvent,
  HostCommandNavigateEvent,
  QueueStateEvent,
  UserMessageEchoEvent,
  PermissionExpiredEvent,
  PermissionResolvedEvent,
  RulesStateEvent,
  QuestionExpiredEvent,
  ConversationModeEvent,
  NoticeEvent,
  ChangeSetEvent,
  UsageEvent,
]);
export type AnyServerEventType = z.infer<typeof AnyServerEvent>;
export type RunResumedEventType = z.infer<typeof RunResumedEvent>;
export type RunProgressEventType = z.infer<typeof RunProgressEvent>;
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
export type ToolCallEndEventType = z.infer<typeof ToolCallEndEvent>;
export type DiffLineType = z.infer<typeof DiffLineSchema>;
export type DiffHunkType = z.infer<typeof DiffHunkSchema>;
export type PermissionPreviewType = z.infer<typeof PermissionPreviewSchema>;
export type DiffPreviewType = z.infer<typeof DiffPreviewSchema>;
export type CommandPreviewType = z.infer<typeof CommandPreviewSchema>;
export type DestructivePreviewType = z.infer<typeof DestructivePreviewSchema>;
export type ActiveRuleType = z.infer<typeof ActiveRuleSchema>;
export type ConversationModeType = z.infer<typeof ConversationModeSchema>;
export type ConversationModeEventType = z.infer<typeof ConversationModeEvent>;
export type ConversationSummaryType = z.infer<typeof ConversationSummarySchema>;
export type ChangeSetEventType = z.infer<typeof ChangeSetEvent>;
export type NoticeEventType = z.infer<typeof NoticeEvent>;
