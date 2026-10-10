import type { PendingRequest } from "../agent/permission-bus.js";
import {
  bareToolName,
  isEditTool,
  isMutatingBuilderTool,
  isReadOnlyTool,
  permissionKindOf,
} from "../agent/tool-kinds.js";
import type {
  ActivityCategory,
  ActivityResult,
  AllowedBy,
  PermissionKind,
} from "../constants/audit.js";
import type { ConversationEntry } from "../state/conversations.js";
import {
  type ChangeSetRecord,
  DEFAULT_PROVIDER_NAME,
  type ProviderName,
  type StoredMessage,
} from "../state/types.js";
import { activityTarget, parseArgs } from "./activity-target.js";

export const UNDO_TOOL_NAME = "UndoChangeSet";
export const REDO_TOOL_NAME = "RedoChangeSet";

const STATE_CHANGE_TOOL: Record<string, string> = {
  undone: UNDO_TOOL_NAME,
  applied: REDO_TOOL_NAME,
};

/** One line of the audit log, as the Activity table shows it. */
export interface ActivityRow {
  id: string;
  timestampMs: number;
  tool: string;
  target: string;
  agent: ProviderName;
  allowedBy: AllowedBy;
  result: ActivityResult;
  resultDetail?: string;
  changeSetId?: string;
  changeSetNumber?: number;
  conversationId: string;
  conversationTitle: string;
  durationMs?: number;
  isReadOnly: boolean;
  isAutoFix: boolean;
  category: ActivityCategory[];
  added?: number;
  removed?: number;
  expiresAtMs?: number;
}

/** A row plus what its detail drawer and the metrics read. */
export interface ActivityRecord extends ActivityRow {
  kind: PermissionKind;
  isAsked: boolean;
  isAlwaysAsk: boolean;
  args: unknown;
  resultText?: string;
  // The approval of the call, when the user was asked.
  permission?: StoredMessage;
  endedAtMs?: number;
}

export interface ActivitySources {
  entries: readonly ConversationEntry[];
  changeSets: readonly ChangeSetRecord[];
  pending: readonly PendingRequest[];
  // Conversations with a turn running: their open calls are still pending.
  running: ReadonlySet<string>;
  hostProjectRoot: string;
}

const RESULT_BY_ALLOWED: Partial<Record<AllowedBy, ActivityResult>> = {
  denied: "denied",
  blocked: "blocked",
  expired: "expired",
};

const DETAIL_BY_RESULT: Partial<Record<ActivityResult, string>> = {
  blocked: "Blocked by safe mode",
  expired: "Request expired",
};

const DENIED_RESULTS: readonly ActivityResult[] = [
  "denied",
  "blocked",
  "expired",
];

interface ConversationIndex {
  results: Map<string, StoredMessage>;
  permissions: Map<string, StoredMessage>;
  changeSets: Map<string, ChangeSetRecord>;
}

function indexConversation(
  entry: ConversationEntry,
  changeSets: readonly ChangeSetRecord[],
): ConversationIndex {
  const results = new Map<string, StoredMessage>();
  const permissions = new Map<string, StoredMessage>();
  for (const message of entry.conversation.messages) {
    if (message.callId === undefined) continue;
    if (message.role === "tool_result") results.set(message.callId, message);
    if (message.role === "permission") permissions.set(message.callId, message);
  }
  const ownSets = changeSets.filter((c) => c.conversationId === entry.id);
  return {
    results,
    permissions,
    changeSets: new Map(ownSets.map((c) => [c.id, c])),
  };
}

// Transcripts written before v2 carry no `allowedBy`: read it off what they do.
function legacyAllowedBy(toolName: string, permission?: StoredMessage) {
  if (permission?.decision !== undefined) {
    return permission.decision === "approved" ? "approved" : "denied";
  }
  if (isReadOnlyTool(toolName)) return "read_auto";
  return isMutatingBuilderTool(toolName) ? "builder_auto" : "approved";
}

function resultOf(
  result: StoredMessage | undefined,
  allowedBy: AllowedBy,
  isRunning: boolean,
): ActivityResult {
  const decided = RESULT_BY_ALLOWED[allowedBy];
  if (decided !== undefined && result?.outcome !== "stopped") return decided;
  if (result === undefined) return isRunning ? "pending" : "stopped";
  if (result.outcome !== undefined) return result.outcome;
  return result.status === "error" ? "failed" : "done";
}

// A shell command may or may not have touched the project: only a change set
// says so. File edits and Builder ops are changes as soon as they succeed.
function isChange(record: ActivityRecord): boolean {
  if (record.result !== "done") return false;
  if (record.changeSetId !== undefined) return true;
  return isEditTool(record.tool) || isMutatingBuilderTool(record.tool);
}

function categoriesOf(record: ActivityRecord): ActivityCategory[] {
  const categories: ActivityCategory[] = [];
  if (isChange(record)) categories.push("changed");
  if (record.isAsked) categories.push("asked");
  if (DENIED_RESULTS.includes(record.result)) categories.push("denied");
  if (record.result === "failed") categories.push("failed");
  return categories;
}

function lineCounts(
  record: ActivityRecord,
  changeSet: ChangeSetRecord | undefined,
) {
  const file = changeSet?.files.find((f) => record.target.endsWith(f.path));
  if (file === undefined) return {};
  return { added: file.added, removed: file.removed };
}

function finish(record: ActivityRecord, changeSet?: ChangeSetRecord) {
  const withCounts = { ...record, ...lineCounts(record, changeSet) };
  const detail = record.resultDetail ?? DETAIL_BY_RESULT[record.result];
  return {
    ...withCounts,
    resultDetail: detail,
    category: categoriesOf(withCounts),
  };
}

interface RowInput {
  entry: ConversationEntry;
  index: ConversationIndex;
  sources: ActivitySources;
}

function callRecord(input: RowInput, use: StoredMessage): ActivityRecord {
  const { entry, index } = input;
  const callId = use.callId ?? String(use.timestampMs);
  const toolName = use.toolName ?? "";
  const result = index.results.get(callId);
  const permission = index.permissions.get(callId);
  const allowedBy =
    result?.allowedBy ??
    use.allowedBy ??
    permission?.allowedBy ??
    legacyAllowedBy(toolName, permission);
  const changeSetId = result?.changeSetId ?? use.changeSetId;
  const changeSet =
    changeSetId === undefined ? undefined : index.changeSets.get(changeSetId);
  const args = parseArgs(use.content);
  const record: ActivityRecord = {
    id: `${entry.id}:${callId}`,
    timestampMs: use.timestampMs,
    tool: bareToolName(toolName),
    target: activityTarget(toolName, args, input.sources.hostProjectRoot),
    agent: entry.conversation.provider ?? DEFAULT_PROVIDER_NAME,
    allowedBy,
    result: resultOf(result, allowedBy, input.sources.running.has(entry.id)),
    resultDetail: permission?.feedback,
    changeSetId: changeSet?.id,
    changeSetNumber: changeSet?.number,
    conversationId: entry.id,
    conversationTitle: entry.title,
    durationMs:
      result === undefined ? undefined : result.timestampMs - use.timestampMs,
    isReadOnly: allowedBy === "read_auto" || isReadOnlyTool(toolName),
    isAutoFix: use.isAutoFix === true,
    category: [],
    kind: permissionKindOf(toolName),
    isAsked: permission !== undefined,
    isAlwaysAsk: permission?.alwaysAsk === true,
    args,
    resultText: result?.content,
    permission,
    endedAtMs: result?.timestampMs,
  };
  return finish(record, changeSet);
}

function permissionOnlyRecord(input: RowInput, permission: StoredMessage) {
  const { entry } = input;
  const toolName = permission.toolName ?? "";
  const allowedBy =
    permission.allowedBy ?? legacyAllowedBy(toolName, permission);
  const record: ActivityRecord = {
    id: `${entry.id}:${permission.requestId ?? permission.callId ?? permission.timestampMs}`,
    timestampMs: permission.requestedAtMs ?? permission.timestampMs,
    tool: bareToolName(toolName),
    target: activityTarget(
      toolName,
      permission.args,
      input.sources.hostProjectRoot,
    ),
    agent: entry.conversation.provider ?? DEFAULT_PROVIDER_NAME,
    allowedBy,
    result: RESULT_BY_ALLOWED[allowedBy] ?? "done",
    resultDetail: permission.feedback,
    conversationId: entry.id,
    conversationTitle: entry.title,
    isReadOnly: false,
    isAutoFix: false,
    category: [],
    kind: permission.kind ?? permissionKindOf(toolName),
    isAsked: true,
    isAlwaysAsk: permission.alwaysAsk === true,
    args: permission.args,
    permission,
  };
  return finish(record);
}

function stateChangeRecords(
  entry: ConversationEntry,
  changeSet: ChangeSetRecord,
): ActivityRecord[] {
  return (changeSet.stateLog ?? []).map((change, position) =>
    finish({
      id: `${entry.id}:${changeSet.id}:${position}`,
      timestampMs: change.atMs,
      tool: STATE_CHANGE_TOOL[change.state] ?? UNDO_TOOL_NAME,
      target: `#${changeSet.number} ${changeSet.title}`,
      agent: changeSet.agent,
      allowedBy: "approved",
      result: "done",
      resultDetail: change.by,
      changeSetId: changeSet.id,
      changeSetNumber: changeSet.number,
      conversationId: entry.id,
      conversationTitle: entry.title,
      isReadOnly: false,
      isAutoFix: changeSet.isAutoFix,
      category: [],
      kind: "other",
      isAsked: false,
      isAlwaysAsk: false,
      args: { changeSetId: changeSet.id },
    }),
  );
}

function pendingRecord(
  input: RowInput,
  request: PendingRequest,
  existing: ActivityRecord | undefined,
): ActivityRecord {
  const base: ActivityRecord = existing ?? {
    id: `${input.entry.id}:${request.callId ?? request.requestId}`,
    timestampMs: request.createdAtMs,
    tool: bareToolName(request.toolName),
    target: activityTarget(
      request.toolName,
      request.args,
      input.sources.hostProjectRoot,
    ),
    agent: input.entry.conversation.provider ?? DEFAULT_PROVIDER_NAME,
    allowedBy: "approved",
    result: "pending",
    conversationId: input.entry.id,
    conversationTitle: input.entry.title,
    isReadOnly: false,
    isAutoFix: false,
    category: [],
    kind: request.kind,
    isAsked: true,
    isAlwaysAsk: request.alwaysAsk,
    args: request.args,
  };
  return finish({
    ...base,
    result: "pending",
    isAsked: true,
    isAlwaysAsk: request.alwaysAsk,
    expiresAtMs: request.expiresAtMs,
  });
}

function conversationRecords(input: RowInput): ActivityRecord[] {
  const messages = input.entry.conversation.messages;
  const calls = messages
    .filter((m) => m.role === "tool_use")
    .map((use) => callRecord(input, use));
  const callIds = new Set(
    messages.filter((m) => m.role === "tool_use").map((m) => m.callId),
  );
  const orphans = messages
    .filter(
      (m) =>
        m.role === "permission" &&
        (m.callId === undefined || !callIds.has(m.callId)),
    )
    .map((permission) => permissionOnlyRecord(input, permission));
  const undos = [...input.index.changeSets.values()].flatMap((c) =>
    stateChangeRecords(input.entry, c),
  );
  return [...calls, ...orphans, ...undos];
}

function applyPending(
  input: RowInput,
  records: ActivityRecord[],
): ActivityRecord[] {
  const own = input.sources.pending.filter(
    (p) => p.conversationId === input.entry.id,
  );
  const byId = new Map(records.map((r) => [r.id, r]));
  for (const request of own) {
    const id = `${input.entry.id}:${request.callId ?? request.requestId}`;
    byId.set(id, pendingRecord(input, request, byId.get(id)));
  }
  return [...byId.values()];
}

/** Every tool call, approval and undo of every conversation, newest first. */
export function buildActivityRecords(
  sources: ActivitySources,
): ActivityRecord[] {
  const records = sources.entries.flatMap((entry) => {
    const input: RowInput = {
      entry,
      index: indexConversation(entry, sources.changeSets),
      sources,
    };
    return applyPending(input, conversationRecords(input));
  });
  return records.sort((a, b) => b.timestampMs - a.timestampMs);
}

const ROW_ONLY_FIELDS: ReadonlyArray<keyof ActivityRecord> = [
  "kind",
  "isAsked",
  "isAlwaysAsk",
  "args",
  "resultText",
  "permission",
  "endedAtMs",
];

export function toActivityRow(record: ActivityRecord): ActivityRow {
  const row = { ...record };
  for (const field of ROW_ONLY_FIELDS) delete row[field];
  return row;
}
