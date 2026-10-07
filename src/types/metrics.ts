/** One point of a chart series. */
export interface SeriesPoint {
  x: string;
  y: number;
}

/** A named chart series. */
export interface NamedSeries {
  name: string;
  data: SeriesPoint[];
}

/** What a `KpiCard` reads, plus the line the backend words under it. */
export interface KpiPayload {
  value: number;
  delta: number;
  previousValue: number;
  sparkline: number[];
  caption?: string;
}

/** The sidecar's KPI, with the totals its caption is built from. */
export interface SidecarKpi extends KpiPayload {
  total?: number;
  denied?: number;
  expired?: number;
}

/** What a `ChartCard` reads. */
export interface ChartPayload {
  value: number;
  delta: number;
  previousValue: number;
  series: NamedSeries[];
  comparisonSeries?: NamedSeries[];
}

/** One row of a `TopListCard`. */
export interface TopListItem {
  id: string;
  title: string;
  description?: string;
  value: number;
  icon?: string;
}

/** What a `TopListCard` reads. */
export interface TopListPayload {
  items: TopListItem[];
}

/** A counted value of a sidecar breakdown. */
export interface CountedValue {
  id: string;
  value: number;
}

/** How the actions of a window were allowed. */
export interface AllowedBreakdown {
  items: CountedValue[];
  deletionsAsked: number;
  deletions: number;
}

/** A tool and how often it ran. */
export interface ToolCount extends CountedValue {
  source: string;
}

/** The tools used most. */
export interface TopTools {
  items: ToolCount[];
}

/** Tokens of one day. */
export interface UsageDay {
  day: string;
  totalTokens: number;
}

/** The conversation that used the most tokens. */
export interface UsageTopConversation {
  conversationId: string;
  title: string;
  totalTokens: number;
}

/** Tokens used per day over a window. */
export interface UsageReport {
  days: UsageDay[];
  totalTokens: number;
  conversations: number;
  top?: UsageTopConversation;
}

/** One row of a `KeyValueList`. */
export interface KeyValueItem {
  id: string;
  label: string;
  value: string | number | null;
  type?: string;
  detail?: string;
}
