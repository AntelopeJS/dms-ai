import type { AllowedBy, ToolSource } from "../constants/audit.js";

// Payload shapes consumed by the DMS dashboard components (KpiCard, ChartCard,
// TopList) — kept structurally identical to what those components expect so the
// DMS backend can proxy sidecar responses through unchanged.

export interface SeriesPoint {
  x: string;
  y: number;
}

export interface NamedSeries {
  name: string;
  data: SeriesPoint[];
}

export interface KpiCardPayload {
  value: number;
  /** Absent without a comparison period, or when it counted zero. */
  delta?: number;
  /** Absent without a comparison period. */
  previousValue?: number;
  sparkline: number[];
  // `approved` only: how many were asked, denied and left to expire, so the
  // backend can caption "21 / 25 · 84%".
  total?: number;
  denied?: number;
  expired?: number;
}

export interface ChartCardPayload {
  value: number;
  /** Absent without a comparison period, or when it counted zero. */
  delta?: number;
  /** Absent without a comparison period. */
  previousValue?: number;
  series: NamedSeries[];
  comparisonSeries?: NamedSeries[];
}

// Metric keys exposed at /metrics/kpi/:metric.
// - "actions": every tool call — raw volume.
// - "change-sets": change sets recorded.
// - "approved" / "denied": calls the user allowed / refused when asked.
// - "undone": change sets undone.
// - "errors": calls that failed (denials and safe-mode blocks excluded).
// - "proposed": calls the user was asked about.
export const KPI_METRICS = [
  "actions",
  "change-sets",
  "approved",
  "denied",
  "undone",
  "errors",
  "proposed",
] as const;
export type KpiMetric = (typeof KPI_METRICS)[number];

interface AllowedItem {
  id: AllowedBy;
  value: number;
  /** Absent without a comparison period, or when it counted zero. */
  delta?: number;
}

export interface AllowedPayload {
  items: AllowedItem[];
  deletionsAsked: number;
  deletions: number;
}

interface TopToolItem {
  id: string;
  value: number;
  /** Absent without a comparison period, or when it counted zero. */
  delta?: number;
  source: ToolSource;
}

export interface TopToolsPayload {
  items: TopToolItem[];
}

export interface UsageDay {
  day: string;
  totalTokens: number;
}

interface UsageTop {
  conversationId: string;
  title: string;
  totalTokens: number;
}

export interface UsagePayload {
  days: UsageDay[];
  totalTokens: number;
  conversations: number;
  top?: UsageTop;
}

export interface MetricWindow {
  fromMs: number;
  toMs: number;
  compareFromMs?: number;
  compareToMs?: number;
}
