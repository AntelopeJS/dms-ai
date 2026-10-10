import type {
  AllowedBy,
  ChangeFileStatus,
  ChangeSetState,
  FullAutoDuration,
  PermissionKind,
  ToolOutcome,
  TypecheckOutcome,
} from "../constants/audit.js";
import type { ChatMode, GenerationMode } from "./settings-types.js";

export const STORED_MESSAGE_ROLES = [
  "user",
  "assistant",
  "tool_use",
  "tool_result",
  // Audit record of a permission decision for a non-auto-allowed (i.e. mutating
  // /shell/network) tool. Emitted from the permission bridge, independent of the
  // tool_use/tool_result pair, so approve/deny rates can be derived.
  "permission",
  "error",
  // Something the sidecar did or saw on the user's behalf (an auto-fix turn, an
  // expired request, a skipped question, Full auto ending), shown in the
  // transcript as a notice rather than a user message.
  "notice",
  // The change set a turn produced, by id; the summary travels separately.
  "change_set",
  // The answers given to an AskUser question, kept for the transcript.
  "question_answer",
] as const;

export type StoredMessageRole = (typeof STORED_MESSAGE_ROLES)[number];

export const STORED_MESSAGE_STATUSES = ["success", "error"] as const;
export type StoredMessageStatus = (typeof STORED_MESSAGE_STATUSES)[number];

// Normalized outcome of a permission decision: the sidecar's three
// PERMISSION_DECISIONS values collapse to approved (allow_once /
// allow_session) vs denied (deny / timeout).
export const STORED_PERMISSION_DECISIONS = ["approved", "denied"] as const;
export type StoredPermissionDecision =
  (typeof STORED_PERMISSION_DECISIONS)[number];

// Lightweight record of a file the user attached, kept for redisplay on
// reload. Deliberately excludes the base64 payload so the transcript store
// stays small — the file itself lives inline in the live turn or on disk.
export interface StoredAttachmentMeta {
  name: string;
  mimeType: string;
  size: number;
}

export interface AutoFixNotice {
  kind: "autofix";
  attempt: number;
  maxAttempts: number;
  errors: string[];
  timestampMs: number;
}

export interface PermissionExpiredNotice {
  kind: "permission_expired";
  toolName: string;
  summary: string;
  timestampMs: number;
}

export interface QuestionSkippedNotice {
  kind: "question_skipped";
  header: string;
  timestampMs: number;
}

export interface FullAutoEndedNotice {
  kind: "full_auto_ended";
  timestampMs: number;
}

export type Notice =
  | AutoFixNotice
  | PermissionExpiredNotice
  | QuestionSkippedNotice
  | FullAutoEndedNotice;

export interface QuestionAnswerRecord {
  header: string;
  question: string;
  answer: string | null;
  skipped: boolean;
  isCustom: boolean;
}

export interface StoredMessage {
  role: StoredMessageRole;
  content: string;
  toolName?: string;
  callId?: string;
  status?: StoredMessageStatus;
  decision?: StoredPermissionDecision;
  attachments?: StoredAttachmentMeta[];
  isRetryable?: boolean;
  timestampMs: number;
  outcome?: ToolOutcome;
  allowedBy?: AllowedBy;
  changeSetId?: string;
  notice?: Notice;
  answers?: QuestionAnswerRecord[];
  // Set on calls made during an auto-fix turn.
  isAutoFix?: boolean;
  // Permission records only: what the request was and when it was answered.
  requestId?: string;
  kind?: PermissionKind;
  alwaysAsk?: boolean;
  summary?: string;
  args?: unknown;
  requestedAtMs?: number;
  expiresAtMs?: number;
  feedback?: string;
  decidedBy?: string;
}

// Agent backends the sidecar can drive. Stored on a conversation so a replayed
// transcript says which one produced it.
export const PROVIDER_NAMES = ["claude", "codex"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const DEFAULT_PROVIDER_NAME: ProviderName = PROVIDER_NAMES[0];

// Tokens a conversation has cost so far, summed over its turns. Codex reports
// them per model call; the Claude SDK reports them on the turn result.
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export const EMPTY_TOKEN_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

/** One turn's token cost, with its time, so per-day totals are exact. */
export interface UsageEntry extends TokenUsage {
  timestampMs: number;
}

export interface StoredConversation {
  messages: StoredMessage[];
  createdAtMs: number;
  updatedAtMs: number;
  // Absent on transcripts written before providers became selectable; readers
  // fall back to DEFAULT_PROVIDER_NAME.
  provider?: ProviderName;
  // Absent until a provider reports usage at least once.
  tokenUsage?: TokenUsage;
  usageLog?: UsageEntry[];
  // The conversation's own approval mode and scope, set from the defaults when
  // its first turn runs. Absent on older transcripts: the defaults apply.
  mode?: ChatMode;
  generationMode?: GenerationMode;
}

export interface StoredState {
  conversations: Record<string, StoredConversation>;
}

/** What the transcript store alone knows of a conversation. */
export interface StoredConversationSummary {
  id: string;
  title: string;
  createdAtMs: number;
  updatedAtMs: number;
  messageCount: number;
  provider?: ProviderName;
  totalTokens: number;
}

/** A conversation as the history drawer lists it: stored plus live state. */
export interface ConversationSummary extends StoredConversationSummary {
  filesChanged: number;
  isRunning: boolean;
  pendingApprovals: number;
  pendingQuestions: number;
  generationMode: GenerationMode;
}

export interface FullAutoState {
  duration: FullAutoDuration;
  untilMs?: number;
}

export interface ChangeSetFile {
  path: string;
  status: ChangeFileStatus;
  added: number;
  removed: number;
}

/** What the chat and the Changes page show of one change set. */
export interface ChangeSetSummary {
  id: string;
  number: number;
  conversationId: string;
  title: string;
  createdAtMs: number;
  agent: ProviderName;
  scope: GenerationMode;
  isAutoFix: boolean;
  overlapped: boolean;
  files: ChangeSetFile[];
  added: number;
  removed: number;
  typecheck: TypecheckOutcome;
  state: ChangeSetState;
  stateChangedAtMs?: number;
  stateChangedBy?: string;
  askedBy?: string;
  approvalsNeeded: number;
  builderOps: number;
}

/** One undo or redo of a change set, for the audit log. */
export interface ChangeSetStateChange {
  state: ChangeSetState;
  atMs: number;
  by?: string;
}

/** A change set as stored: the summary plus the two checkpoint trees. */
export interface ChangeSetRecord extends ChangeSetSummary {
  beforeTree: string;
  afterTree: string;
  pagePath?: string;
  stateLog?: ChangeSetStateChange[];
}
