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
  delta: number;
  previousValue: number;
  sparkline: number[];
  // `approved` only: how many were asked, denied and left to expire, so the
  // backend can caption "21 / 25 · 84%".
  total?: number;
  denied?: number;
  expired?: number;
}

export interface ChartCardPayload {
  value: number;
  delta: number;
  previousValue: number;
  series: NamedSeries[];
  comparisonSeries?: NamedSeries[];
}

export interface TopListItem {
  id: string;
  title: string;
  description?: string;
  value: number;
  delta?: number | null;
  sparkline?: number[];
}

export interface TopListPayload {
  items: TopListItem[];
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

export interface AllowedItem {
  id: AllowedBy;
  value: number;
}

export interface AllowedPayload {
  items: AllowedItem[];
  deletionsAsked: number;
  deletions: number;
}

export interface TopToolItem {
  id: string;
  value: number;
  source: ToolSource;
}

export interface TopToolsPayload {
  items: TopToolItem[];
}

export interface UsageDay {
  day: string;
  totalTokens: number;
}

export interface UsageTop {
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
