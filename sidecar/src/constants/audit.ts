/**
 * How a tool call came to run (or not). Recorded on every call, it drives the
 * audit log, the Overview's "How actions were allowed" and the approval KPIs.
 */
export const ALLOWED_BY_VALUES = [
  "read_auto",
  "builder_auto",
  "approved",
  "rule",
  "full_auto",
  "blocked",
  "denied",
  "expired",
] as const;
export type AllowedBy = (typeof ALLOWED_BY_VALUES)[number];

/** How a tool call ended. `waiting` and `running` are derived by the client. */
export const TOOL_OUTCOMES = [
  "done",
  "failed",
  "denied",
  "blocked",
  "stopped",
] as const;
export type ToolOutcome = (typeof TOOL_OUTCOMES)[number];

export const PERMISSION_KINDS = [
  "edit",
  "command",
  "web",
  "destructive",
  "builder",
  "other",
] as const;
export type PermissionKind = (typeof PERMISSION_KINDS)[number];

export const RULE_KINDS = ["file", "directory", "command", "domain"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const FULL_AUTO_DURATIONS = ["turn", "30m", "chat"] as const;
export type FullAutoDuration = (typeof FULL_AUTO_DURATIONS)[number];

export const NOTICE_KINDS = [
  "autofix",
  "permission_expired",
  "question_skipped",
  "full_auto_ended",
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const CHANGE_SET_STATES = ["applied", "undone"] as const;
export type ChangeSetState = (typeof CHANGE_SET_STATES)[number];

export const TYPECHECK_OUTCOMES = ["passed", "failed", "skipped"] as const;
export type TypecheckOutcome = (typeof TYPECHECK_OUTCOMES)[number];

export const CHANGE_FILE_STATUSES = ["added", "modified", "deleted"] as const;
export type ChangeFileStatus = (typeof CHANGE_FILE_STATUSES)[number];

export const ACTIVITY_RESULTS = [
  ...TOOL_OUTCOMES,
  "pending",
  "expired",
] as const;
export type ActivityResult = (typeof ACTIVITY_RESULTS)[number];

export const ACTIVITY_CATEGORIES = [
  "changed",
  "asked",
  "denied",
  "failed",
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const TOOL_SOURCES = [
  "builder",
  "project",
  "code",
  "web",
  "assistant",
] as const;
export type ToolSource = (typeof TOOL_SOURCES)[number];
