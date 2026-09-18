export const STORED_MESSAGE_ROLES = [
  "user",
  "assistant",
  "tool_use",
  "tool_result",
  // Audit record of a permission decision for a non-auto-allowed (i.e. mutating
  // /shell/network) tool. Emitted from the permission bridge, independent of the
  // tool_use/tool_result pair, so approve/deny rates can be derived.
  "permission",
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

export interface StoredMessage {
  role: StoredMessageRole;
  content: string;
  toolName?: string;
  callId?: string;
  status?: StoredMessageStatus;
  decision?: StoredPermissionDecision;
  attachments?: StoredAttachmentMeta[];
  timestampMs: number;
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

export interface StoredConversation {
  messages: StoredMessage[];
  createdAtMs: number;
  updatedAtMs: number;
  // Absent on transcripts written before providers became selectable; readers
  // fall back to DEFAULT_PROVIDER_NAME.
  provider?: ProviderName;
  // Absent until a provider reports usage at least once.
  tokenUsage?: TokenUsage;
}

export interface StoredState {
  conversations: Record<string, StoredConversation>;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAtMs: number;
  updatedAtMs: number;
  messageCount: number;
}
