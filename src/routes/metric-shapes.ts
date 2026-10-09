import { I18N_SECTIONS } from "../constants/i18n";
import type {
  AllowedBreakdown,
  ChartPayload,
  KeyValueItem,
  KpiPayload,
  SidecarKpi,
  TopListItem,
  TopListPayload,
  TopTools,
  ToolCount,
  UsageReport,
} from "../types";
import {
  ALLOWED_BY,
  bareToolName,
  findLoggedTool,
  i18nKey,
  TOOL_SOURCES,
  toolLabel,
  vocabularyLabel,
} from "../vocabulary";

const ACTIVITY = I18N_SECTIONS.ACTIVITY;
const SETTINGS = I18N_SECTIONS.SETTINGS;
const PERCENT = 100;
const DELETIONS_ICON = "i-ph-trash";
const FALLBACK_TOOL_ICON = "i-ph-wrench";

type CaptionWriter = (kpi: SidecarKpi) => string | undefined;

function share(value: number, total: number): string {
  return `${value} / ${total} · ${Math.round((value / total) * PERCENT)}%`;
}

/** The line under a KPI, built from the totals the sidecar sends with it. */
const CAPTIONS: Readonly<Record<string, CaptionWriter>> = {
  approved: (kpi) => (kpi.total ? share(kpi.value, kpi.total) : undefined),
  undone: (kpi) =>
    kpi.total === undefined ? undefined : `${kpi.value} / ${kpi.total}`,
};

/** A KPI as the card reads it, with its caption. */
export function kpiPayload(metric: string) {
  return (kpi: SidecarKpi): KpiPayload => ({
    value: kpi.value,
    delta: kpi.delta,
    previousValue: kpi.previousValue,
    sparkline: kpi.sparkline,
    caption: CAPTIONS[metric]?.(kpi),
  });
}

function deletionsRow(breakdown: AllowedBreakdown): TopListItem[] {
  if (breakdown.deletions === 0) return [];
  return [
    {
      id: "deletions_asked",
      title: i18nKey(ACTIVITY, "allowed_metric", "deletions_asked"),
      description: i18nKey(ACTIVITY, "allowed_metric", "deletions_note"),
      value: breakdown.deletionsAsked,
      icon: DELETIONS_ICON,
    },
  ];
}

/** How actions were allowed, one translated row per way, then deletions. */
export function allowedPayload(breakdown: AllowedBreakdown): TopListPayload {
  const counts = new Map(breakdown.items.map((item) => [item.id, item.value]));
  const rows = Object.entries(ALLOWED_BY).flatMap(([id, entry]) => {
    const value = counts.get(id) ?? 0;
    if (value === 0) return [];
    const title = vocabularyLabel(ACTIVITY, "allowed_by", id);
    return [{ id, title, value, icon: entry.icon }];
  });
  return { items: [...rows, ...deletionsRow(breakdown)] };
}

function toolRow(tool: ToolCount): TopListItem {
  const known = findLoggedTool(tool.id);
  return {
    id: tool.id,
    title: known ? toolLabel(ACTIVITY, known.name) : bareToolName(tool.id),
    description: vocabularyLabel(ACTIVITY, "tool_source", tool.source),
    value: tool.value,
    icon: known?.icon ?? TOOL_SOURCES[tool.source]?.icon ?? FALLBACK_TOOL_ICON,
  };
}

/** The tools used most, by their translated verb and their group. */
export function topToolsPayload(tools: TopTools): TopListPayload {
  return { items: tools.items.map(toolRow) };
}

/** Tokens per day, as a column chart reads them. */
export function usageChartPayload(report: UsageReport): ChartPayload {
  return {
    value: report.totalTokens,
    delta: 0,
    previousValue: 0,
    series: [
      {
        name: i18nKey(SETTINGS, "usage", "series"),
        data: report.days.map((day) => ({ x: day.day, y: day.totalTokens })),
      },
    ],
  };
}

/** The window's totals: tokens, conversations, and the biggest one. */
export function usageSummaryPayload(report: UsageReport) {
  const items: KeyValueItem[] = [
    {
      id: "tokens",
      label: i18nKey(SETTINGS, "usage", "total_tokens"),
      value: report.totalTokens,
      type: "mono",
    },
    {
      id: "conversations",
      label: i18nKey(SETTINGS, "usage", "conversations"),
      value: report.conversations,
      type: "mono",
    },
  ];
  if (report.top) {
    items.push({
      id: "top",
      label: i18nKey(SETTINGS, "usage", "top_conversation"),
      value: report.top.title,
      detail: {
        key: i18nKey(SETTINGS, "usage", "top_tokens"),
        params: { count: { type: "count", value: report.top.totalTokens } },
      },
    });
  }
  return { items };
}
