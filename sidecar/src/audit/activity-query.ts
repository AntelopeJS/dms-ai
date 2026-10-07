import { diffTexts } from "../agent/line-diff.js";
import { isEditTool } from "../agent/tool-kinds.js";
import type { ActivityCategory } from "../constants/audit.js";
import type { DiffHunkType } from "../protocol/events.js";
import type { ActivityRecord, ActivityRow } from "./activity.js";
import { toActivityRow } from "./activity.js";

export const MAX_ACTIVITY_OUTPUT_CHARS = 20_000;
const TRUNCATION_MARKER = "\n…";

/** The Activity table's query, as the sidecar route reads it. */
export interface ActivityQuery {
  offset: number;
  limit: number;
  search?: string;
  category?: ActivityCategory;
  tool?: string;
  agent?: string;
  conversationId?: string;
  hideReadOnly: boolean;
  fromMs?: number;
  toMs?: number;
}

export interface ActivityPage {
  results: ActivityRow[];
  total: number;
}

export interface DecisionStep {
  atMs: number;
  label: string;
}

export interface ActivityFileDiff {
  path: string;
  hunks: DiffHunkType[];
}

/** One row with what its drawer shows. */
export interface ActivityDetail extends ActivityRow {
  args: unknown;
  // The tool's output, truncated; `result` stays the row's status.
  output?: string;
  diff?: ActivityFileDiff[];
  decisionTrail: DecisionStep[];
}

type RecordFilter = (record: ActivityRecord, query: ActivityQuery) => boolean;

function includesText(record: ActivityRecord, search: string): boolean {
  const needle = search.toLowerCase();
  return [record.tool, record.target, record.conversationTitle].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

const FILTERS: readonly RecordFilter[] = [
  (r, q) =>
    q.search === undefined || q.search === "" || includesText(r, q.search),
  (r, q) => q.category === undefined || r.category.includes(q.category),
  (r, q) => q.tool === undefined || r.tool === q.tool,
  (r, q) => q.agent === undefined || r.agent === q.agent,
  (r, q) =>
    q.conversationId === undefined || r.conversationId === q.conversationId,
  (r, q) => !q.hideReadOnly || !r.isReadOnly,
  (r, q) => q.fromMs === undefined || r.timestampMs >= q.fromMs,
  (r, q) => q.toMs === undefined || r.timestampMs <= q.toMs,
];

export function queryActivity(
  records: readonly ActivityRecord[],
  query: ActivityQuery,
): ActivityPage {
  const matching = records.filter((record) =>
    FILTERS.every((filter) => filter(record, query)),
  );
  return {
    results: matching
      .slice(query.offset, query.offset + query.limit)
      .map(toActivityRow),
    total: matching.length,
  };
}

const ALLOWED_LABELS: Record<string, string> = {
  read_auto: "Allowed automatically (read-only)",
  builder_auto: "Allowed automatically (Builder)",
  approved: "Allowed by you",
  rule: "Allowed by a rule",
  full_auto: "Allowed by Full auto",
  blocked: "Blocked by safe mode",
  denied: "Denied",
  expired: "Request expired",
};

const RESULT_LABELS: Record<string, string> = {
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

function permissionSteps(record: ActivityRecord): DecisionStep[] {
  const permission = record.permission;
  if (permission === undefined) return [];
  const decidedBy =
    permission.decidedBy === undefined ? "" : ` (${permission.decidedBy})`;
  return [
    {
      atMs: permission.requestedAtMs ?? record.timestampMs,
      label: "Asked you",
    },
    {
      atMs: permission.timestampMs,
      label: `${ALLOWED_LABELS[record.allowedBy] ?? record.allowedBy}${decidedBy}`,
    },
  ];
}

/** When the call was asked about, how it was allowed, and how it ended. */
export function decisionTrail(record: ActivityRecord): DecisionStep[] {
  const steps: DecisionStep[] = [
    { atMs: record.timestampMs, label: "Requested" },
  ];
  const asked = permissionSteps(record);
  if (asked.length > 0) {
    steps.push(...asked);
  } else {
    steps.push({
      atMs: record.timestampMs,
      label: ALLOWED_LABELS[record.allowedBy] ?? record.allowedBy,
    });
  }
  const resultLabel = RESULT_LABELS[record.result];
  if (resultLabel !== undefined && record.endedAtMs !== undefined) {
    steps.push({ atMs: record.endedAtMs, label: resultLabel });
  }
  return steps;
}

function truncate(text: string | undefined): string | undefined {
  if (text === undefined || text.length <= MAX_ACTIVITY_OUTPUT_CHARS)
    return text;
  return `${text.slice(0, MAX_ACTIVITY_OUTPUT_CHARS)}${TRUNCATION_MARKER}`;
}

function readString(args: unknown, key: string): string {
  if (args === null || typeof args !== "object") return "";
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/** The edit as the agent asked for it, when no change set holds its diff. */
export function diffFromArgs(
  record: ActivityRecord,
): ActivityFileDiff[] | undefined {
  if (!isEditTool(record.tool)) return undefined;
  const content = readString(record.args, "content");
  const stats =
    content !== ""
      ? diffTexts("", content)
      : diffTexts(
          readString(record.args, "old_string"),
          readString(record.args, "new_string"),
        );
  if (stats.hunks.length === 0) return undefined;
  return [{ path: record.target, hunks: stats.hunks }];
}

export function buildActivityDetail(
  record: ActivityRecord,
  diff: ActivityFileDiff[] | undefined,
): ActivityDetail {
  return {
    ...toActivityRow(record),
    args: record.args,
    output: truncate(record.resultText),
    diff,
    decisionTrail: decisionTrail(record),
  };
}
