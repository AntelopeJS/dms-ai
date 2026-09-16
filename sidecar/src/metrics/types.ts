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

export type ActivityStatus = "success" | "error" | "pending";

export interface ActivityItem {
  id: string;
  timestampMs: number;
  toolName: string;
  status: ActivityStatus;
  conversationId: string;
  conversationTitle: string;
  summary: string;
}

export interface ActivityPayload {
  items: ActivityItem[];
}

// Metric keys exposed at /metrics/kpi/:metric.
// - "actions": every tool invocation (incl. auto-allowed reads) — raw volume.
// - "proposed": tools routed through the permission bus (mutations/shell/net),
//   including repeats auto-resolved by an earlier "allow session" verdict.
// - "approved" / "denied": the outcome of those proposals; session-approved
//   repeats count as approved without a fresh per-call human verdict.
// - "errors": tool_result failures, excluding permission denials (real errors).
export const KPI_METRICS = [
  "actions",
  "proposed",
  "approved",
  "denied",
  "errors",
] as const;
export type KpiMetric = (typeof KPI_METRICS)[number];

export interface MetricWindow {
  fromMs: number;
  toMs: number;
  compareFromMs?: number;
  compareToMs?: number;
}
