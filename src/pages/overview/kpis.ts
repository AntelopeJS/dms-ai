import { KpiCard } from "@antelopejs/interface-dms/base";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import { OVERVIEW_PERIOD_SCOPE, PAGE_ROUTES } from "../../constants/pages";
import { blockMeta, blockText } from "../meta";

interface KpiDeclaration {
  /** Child id, block key and the metric the sidecar counts. */
  metric: string;
  icon: string;
  /** A rise is bad news: the delta reads red. */
  isInverted?: boolean;
}

const KPIS: readonly KpiDeclaration[] = [
  { metric: "actions", icon: "i-ph-lightning" },
  { metric: "change-sets", icon: "i-ph-git-diff" },
  { metric: "approved", icon: "i-ph-check-circle" },
  { metric: "undone", icon: "i-ph-arrow-counter-clockwise", isInverted: true },
];

const KPI_ROW_ID = "row";
const GRID_GAP = "1rem";

function blockPath(metric: string): string {
  return `overview.kpi_${metric.replace("-", "_")}`;
}

function kpiCard(kpi: KpiDeclaration): ComponentBuilder {
  const path = blockPath(kpi.metric);
  return KpiCard({
    title: blockText(path, "title"),
    description: blockText(path, "caption"),
    icon: kpi.icon,
    fetchUrl: `${PAGE_ROUTES.KPI}/${kpi.metric}`,
    periodScope: OVERVIEW_PERIOD_SCOPE,
    valueFormat: "compact",
    invert: kpi.isInverted,
  }).meta(blockMeta(path, kpi.icon));
}

/** The Overview's four headline figures, in one row. */
export function overviewKpis(): ComponentBuilder {
  const row = GridRow().meta(blockMeta("overview.kpis_row", "i-ph-rows"));
  for (const kpi of KPIS) row.child(kpi.metric, kpiCard(kpi));
  return Grid({ gap: GRID_GAP })
    .meta(blockMeta("overview.kpis", "i-ph-squares-four"))
    .child(KPI_ROW_ID, row);
}
