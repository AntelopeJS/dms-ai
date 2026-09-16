import type { StoredConversation, StoredMessage } from "../state/types.js";
import type {
  ActivityItem,
  ActivityPayload,
  ChartCardPayload,
  KpiCardPayload,
  KpiMetric,
  MetricWindow,
  NamedSeries,
  SeriesPoint,
  TopListPayload,
} from "./types.js";

const MS_PER_DAY = 86_400_000;
const MAX_BUCKETS = 60;
const ACTIVITY_SUMMARY_MAX = 80;
// Length of the "YYYY-MM-DD" prefix of an ISO timestamp.
const DAY_KEY_LENGTH = 10;

export interface ConversationEntry {
  id: string;
  title: string;
  conversation: StoredConversation;
}

interface FlatMessage {
  conversationId: string;
  conversationTitle: string;
  msg: StoredMessage;
}

function flatten(entries: readonly ConversationEntry[]): FlatMessage[] {
  const out: FlatMessage[] = [];
  for (const entry of entries) {
    for (const msg of entry.conversation.messages) {
      out.push({
        conversationId: entry.id,
        conversationTitle: entry.title,
        msg,
      });
    }
  }
  return out;
}

function inRange(ts: number, fromMs: number, toMs: number): boolean {
  return ts >= fromMs && ts <= toMs;
}

const METRIC_MATCHERS: Record<KpiMetric, (msg: StoredMessage) => boolean> = {
  actions: (msg) => msg.role === "tool_use",
  proposed: (msg) => msg.role === "permission",
  approved: (msg) => msg.role === "permission" && msg.decision === "approved",
  denied: (msg) => msg.role === "permission" && msg.decision === "denied",
  // "errors": raw tool failures. The displayed value subtracts denials in
  // buildKpi (a denied tool also surfaces as an error tool_result).
  errors: (msg) => msg.role === "tool_result" && msg.status === "error",
};

function matchesMetric(msg: StoredMessage, metric: KpiMetric): boolean {
  return METRIC_MATCHERS[metric](msg);
}

function countMetric(
  flat: readonly FlatMessage[],
  metric: KpiMetric,
  fromMs: number,
  toMs: number,
): number {
  let count = 0;
  for (const { msg } of flat) {
    if (inRange(msg.timestampMs, fromMs, toMs) && matchesMetric(msg, metric)) {
      count += 1;
    }
  }
  return count;
}

function deltaPercent(current: number, previous: number): number {
  if (!previous) return 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
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
    keys.push(
      new Date(day * MS_PER_DAY).toISOString().slice(0, DAY_KEY_LENGTH),
    );
  }
  return keys;
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, DAY_KEY_LENGTH);
}

function dailyCounts(
  flat: readonly FlatMessage[],
  metric: KpiMetric,
  fromMs: number,
  toMs: number,
): number[] {
  const buckets = dayBuckets(fromMs, toMs);
  const index = new Map(buckets.map((key, i) => [key, i]));
  const counts = Array.from({ length: buckets.length }, (): number => 0);
  for (const { msg } of flat) {
    if (!inRange(msg.timestampMs, fromMs, toMs)) continue;
    if (!matchesMetric(msg, metric)) continue;
    const i = index.get(dayKey(msg.timestampMs));
    if (i !== undefined) counts[i] += 1;
  }
  return counts;
}

// Real execution failures = error tool_results minus permission denials, which
// the SDK also surfaces as an error tool_result. Clamped so the two counters
// can never drive the displayed value negative.
function countErrors(
  flat: readonly FlatMessage[],
  fromMs: number,
  toMs: number,
): number {
  const errors = countMetric(flat, "errors", fromMs, toMs);
  const denied = countMetric(flat, "denied", fromMs, toMs);
  return Math.max(0, errors - denied);
}

function countKpi(
  flat: readonly FlatMessage[],
  metric: KpiMetric,
  fromMs: number,
  toMs: number,
): number {
  if (metric === "errors") return countErrors(flat, fromMs, toMs);
  return countMetric(flat, metric, fromMs, toMs);
}

export function buildKpi(
  entries: readonly ConversationEntry[],
  metric: KpiMetric,
  window: MetricWindow,
): KpiCardPayload {
  const flat = flatten(entries);
  const value = countKpi(flat, metric, window.fromMs, window.toMs);
  const hasCompare =
    window.compareFromMs !== undefined && window.compareToMs !== undefined;
  const previousValue = hasCompare
    ? countKpi(
        flat,
        metric,
        window.compareFromMs as number,
        window.compareToMs as number,
      )
    : value;
  return {
    value,
    previousValue,
    delta: hasCompare ? deltaPercent(value, previousValue) : 0,
    sparkline: dailyCounts(flat, metric, window.fromMs, window.toMs),
  };
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
  entries: readonly ConversationEntry[],
  window: MetricWindow,
): ChartCardPayload {
  const flat = flatten(entries);
  const keys = dayBuckets(window.fromMs, window.toMs);
  const counts = dailyCounts(flat, "actions", window.fromMs, window.toMs);
  const value = total(counts);
  const hasCompare =
    window.compareFromMs !== undefined && window.compareToMs !== undefined;
  let comparisonSeries: NamedSeries[] | undefined;
  let previousValue = value;
  if (hasCompare) {
    const compareCounts = dailyCounts(
      flat,
      "actions",
      window.compareFromMs as number,
      window.compareToMs as number,
    );
    previousValue = total(compareCounts);
    comparisonSeries = [seriesFrom("Comparison", keys, compareCounts)];
  }
  return {
    value,
    previousValue,
    delta: hasCompare ? deltaPercent(value, previousValue) : 0,
    series: [seriesFrom("Actions", keys, counts)],
    comparisonSeries,
  };
}

export function buildTopSkills(
  entries: readonly ConversationEntry[],
  window: MetricWindow,
  limit: number,
): TopListPayload {
  const flat = flatten(entries);
  const counts = new Map<string, number>();
  for (const { msg } of flat) {
    if (msg.role !== "tool_use") continue;
    if (!inRange(msg.timestampMs, window.fromMs, window.toMs)) continue;
    const name = msg.toolName ?? "unknown";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const items = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({
      id: name,
      title: name,
      description: `${value} run${value === 1 ? "" : "s"}`,
      value,
      delta: null,
    }));
  return { items };
}

function truncate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= ACTIVITY_SUMMARY_MAX) return trimmed;
  return `${trimmed.slice(0, ACTIVITY_SUMMARY_MAX).trimEnd()}…`;
}

// callId -> status map across a single conversation, so each tool_use can show
// the outcome of its matching tool_result.
function statusByCallId(conversation: StoredConversation): Map<string, string> {
  const map = new Map<string, string>();
  for (const msg of conversation.messages) {
    if (msg.role === "tool_result" && msg.callId && msg.status) {
      map.set(msg.callId, msg.status);
    }
  }
  return map;
}

export function buildActivity(
  entries: readonly ConversationEntry[],
  window: MetricWindow,
  limit: number,
): ActivityPayload {
  const items: ActivityItem[] = [];
  for (const entry of entries) {
    const statuses = statusByCallId(entry.conversation);
    for (const msg of entry.conversation.messages) {
      if (msg.role !== "tool_use") continue;
      if (!inRange(msg.timestampMs, window.fromMs, window.toMs)) continue;
      const callId = msg.callId ?? "";
      const status = statuses.get(callId);
      items.push({
        id: `${entry.id}:${callId || msg.timestampMs}`,
        timestampMs: msg.timestampMs,
        toolName: msg.toolName ?? "unknown",
        status: status === "success" || status === "error" ? status : "pending",
        conversationId: entry.id,
        conversationTitle: entry.title,
        summary: truncate(msg.content || msg.toolName || ""),
      });
    }
  }
  items.sort((a, b) => b.timestampMs - a.timestampMs);
  return { items: items.slice(0, limit) };
}
