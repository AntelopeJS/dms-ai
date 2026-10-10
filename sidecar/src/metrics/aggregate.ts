import type { ActivityRecord } from "../audit/activity.js";
import { REDO_TOOL_NAME, UNDO_TOOL_NAME } from "../audit/activity.js";
import { toolSourceOf } from "../agent/tool-kinds.js";
import { ALLOWED_BY_VALUES } from "../constants/audit.js";
import type { ConversationEntry } from "../state/conversations.js";
import type { ChangeSetRecord } from "../state/types.js";
import type {
  AllowedPayload,
  ChartCardPayload,
  KpiCardPayload,
  KpiMetric,
  MetricWindow,
  NamedSeries,
  SeriesPoint,
  TopListPayload,
  TopToolsPayload,
  UsagePayload,
} from "./types.js";

const MS_PER_DAY = 86_400_000;
const MAX_BUCKETS = 60;
// Length of the "YYYY-MM-DD" prefix of an ISO timestamp.
const DAY_KEY_LENGTH = 10;
const PERCENT_ROUNDING = 1000;
const PERCENT_DIVISOR = 10;

/** What every metric is computed from. */
export interface MetricSources {
  records: readonly ActivityRecord[];
  changeSets: readonly ChangeSetRecord[];
  entries: readonly ConversationEntry[];
}

type TimestampSource = (sources: MetricSources) => number[];

const STATE_CHANGE_TOOLS: readonly string[] = [UNDO_TOOL_NAME, REDO_TOOL_NAME];

function calls(sources: MetricSources): ActivityRecord[] {
  return sources.records.filter((r) => !STATE_CHANGE_TOOLS.includes(r.tool));
}

function timestampsOf(
  predicate: (record: ActivityRecord) => boolean,
): TimestampSource {
  return (sources) =>
    calls(sources)
      .filter(predicate)
      .map((record) => record.timestampMs);
}

function undoTimestamps(sources: MetricSources): number[] {
  return sources.changeSets.flatMap((changeSet) =>
    (changeSet.stateLog ?? [])
      .filter((change) => change.state === "undone")
      .map((change) => change.atMs),
  );
}

const KPI_SOURCES: Record<KpiMetric, TimestampSource> = {
  actions: timestampsOf(() => true),
  "change-sets": (sources) => sources.changeSets.map((c) => c.createdAtMs),
  approved: timestampsOf((r) => r.isAsked && r.allowedBy === "approved"),
  denied: timestampsOf((r) => r.allowedBy === "denied"),
  undone: undoTimestamps,
  errors: timestampsOf((r) => r.result === "failed"),
  proposed: timestampsOf((r) => r.isAsked),
};

function inRange(ts: number, fromMs: number, toMs: number): boolean {
  return ts >= fromMs && ts <= toMs;
}

function countIn(timestamps: number[], fromMs: number, toMs: number): number {
  return timestamps.filter((ts) => inRange(ts, fromMs, toMs)).length;
}

function deltaPercent(current: number, previous: number): number {
  if (!previous) return 0;
  return (
    Math.round(((current - previous) / previous) * PERCENT_ROUNDING) /
    PERCENT_DIVISOR
  );
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, DAY_KEY_LENGTH);
}

// Inclusive list of UTC day keys ("YYYY-MM-DD") spanning [fromMs, toMs],
// capped so a huge range never produces an unbounded array.
function dayBuckets(fromMs: number, toMs: number): string[] {
  const startDay = Math.floor(fromMs / MS_PER_DAY);
  const endDay = Math.floor(toMs / MS_PER_DAY);
  const span = Math.max(0, endDay - startDay);
  const step = span >= MAX_BUCKETS ? Math.ceil((span + 1) / MAX_BUCKETS) : 1;
  const keys: string[] = [];
  for (let day = startDay; day <= endDay; day += step) {
    keys.push(dayKey(day * MS_PER_DAY));
  }
  return keys;
}

function dailySums(
  points: ReadonlyArray<readonly [number, number]>,
  fromMs: number,
  toMs: number,
): number[] {
  const buckets = dayBuckets(fromMs, toMs);
  const index = new Map(buckets.map((key, i) => [key, i]));
  const sums = buckets.map(() => 0);
  for (const [ts, amount] of points) {
    if (!inRange(ts, fromMs, toMs)) continue;
    const i = index.get(dayKey(ts));
    if (i !== undefined) sums[i] = (sums[i] ?? 0) + amount;
  }
  return sums;
}

function dailyCounts(timestamps: number[], fromMs: number, toMs: number) {
  return dailySums(
    timestamps.map((ts) => [ts, 1] as const),
    fromMs,
    toMs,
  );
}

interface Comparison {
  previousValue: number;
  delta: number;
}

function compare(
  timestamps: number[],
  value: number,
  window: MetricWindow,
): Comparison {
  if (window.compareFromMs === undefined || window.compareToMs === undefined) {
    return { previousValue: value, delta: 0 };
  }
  const previousValue = countIn(
    timestamps,
    window.compareFromMs,
    window.compareToMs,
  );
  return { previousValue, delta: deltaPercent(value, previousValue) };
}

function approvalBreakdown(sources: MetricSources, window: MetricWindow) {
  const asked = calls(sources).filter(
    (r) => r.isAsked && inRange(r.timestampMs, window.fromMs, window.toMs),
  );
  return {
    total: asked.length,
    denied: asked.filter((r) => r.allowedBy === "denied").length,
    expired: asked.filter((r) => r.allowedBy === "expired").length,
  };
}

export function buildKpi(
  sources: MetricSources,
  metric: KpiMetric,
  window: MetricWindow,
): KpiCardPayload {
  const timestamps = KPI_SOURCES[metric](sources);
  const value = countIn(timestamps, window.fromMs, window.toMs);
  const payload: KpiCardPayload = {
    value,
    ...compare(timestamps, value, window),
    sparkline: dailyCounts(timestamps, window.fromMs, window.toMs),
  };
  if (metric !== "approved") return payload;
  return { ...payload, ...approvalBreakdown(sources, window) };
}

function seriesFrom(
  name: string,
  keys: string[],
  counts: number[],
): NamedSeries {
  const data: SeriesPoint[] = keys.map((x, i) => ({ x, y: counts[i] ?? 0 }));
  return { name, data };
}

function total(counts: readonly number[]): number {
  return counts.reduce((acc, n) => acc + n, 0);
}

export function buildSeries(
  sources: MetricSources,
  window: MetricWindow,
): ChartCardPayload {
  const timestamps = KPI_SOURCES.actions(sources);
  const keys = dayBuckets(window.fromMs, window.toMs);
  const counts = dailyCounts(timestamps, window.fromMs, window.toMs);
  const value = total(counts);
  const payload: ChartCardPayload = {
    value,
    ...compare(timestamps, value, window),
    series: [seriesFrom("Actions", keys, counts)],
  };
  if (window.compareFromMs === undefined || window.compareToMs === undefined) {
    return payload;
  }
  const compareCounts = dailyCounts(
    timestamps,
    window.compareFromMs,
    window.compareToMs,
  );
  return {
    ...payload,
    comparisonSeries: [seriesFrom("Comparison", keys, compareCounts)],
  };
}

function inWindow(sources: MetricSources, window: MetricWindow) {
  return calls(sources).filter((r) =>
    inRange(r.timestampMs, window.fromMs, window.toMs),
  );
}

function countBy<T extends string>(
  records: readonly ActivityRecord[],
  key: (record: ActivityRecord) => T,
): Map<T, number> {
  const counts = new Map<T, number>();
  for (const record of records) {
    const id = key(record);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** "How actions were allowed": one count per way, plus the deletions line. */
export function buildAllowed(
  sources: MetricSources,
  window: MetricWindow,
): AllowedPayload {
  const records = inWindow(sources, window);
  const counts = countBy(records, (r) => r.allowedBy);
  const deletions = records.filter((r) => r.kind === "destructive");
  return {
    items: ALLOWED_BY_VALUES.map((id) => ({ id, value: counts.get(id) ?? 0 })),
    deletionsAsked: deletions.filter((r) => r.isAsked).length,
    deletions: deletions.length,
  };
}

function topCounts(
  sources: MetricSources,
  window: MetricWindow,
  limit: number,
): Array<[string, number]> {
  const counts = countBy(inWindow(sources, window), (r) => r.tool);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function buildTopTools(
  sources: MetricSources,
  window: MetricWindow,
  limit: number,
): TopToolsPayload {
  return {
    items: topCounts(sources, window, limit).map(([id, value]) => ({
      id,
      value,
      source: toolSourceOf(id),
    })),
  };
}

/** The pre-v2 top list shape, kept for clients that still read it. */
export function buildTopSkills(
  sources: MetricSources,
  window: MetricWindow,
  limit: number,
): TopListPayload {
  return {
    items: topCounts(sources, window, limit).map(([name, value]) => ({
      id: name,
      title: name,
      description: `${value} run${value === 1 ? "" : "s"}`,
      value,
      delta: null,
    })),
  };
}

function conversationTokens(entry: ConversationEntry, window: MetricWindow) {
  return (entry.conversation.usageLog ?? [])
    .filter((u) => inRange(u.timestampMs, window.fromMs, window.toMs))
    .reduce((sum, u) => sum + u.totalTokens, 0);
}

/** Tokens per day over the window, the total, and the costliest chat. */
export function buildUsage(
  sources: MetricSources,
  window: MetricWindow,
): UsagePayload {
  const points = sources.entries.flatMap((entry) =>
    (entry.conversation.usageLog ?? []).map(
      (u) => [u.timestampMs, u.totalTokens] as const,
    ),
  );
  const keys = dayBuckets(window.fromMs, window.toMs);
  const sums = dailySums(points, window.fromMs, window.toMs);
  const perConversation = sources.entries
    .map((entry) => ({
      conversationId: entry.id,
      title: entry.title,
      totalTokens: conversationTokens(entry, window),
    }))
    .filter((c) => c.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens);
  return {
    days: keys.map((day, i) => ({ day, totalTokens: sums[i] ?? 0 })),
    totalTokens: total(sums),
    conversations: perConversation.length,
    top: perConversation[0],
  };
}
