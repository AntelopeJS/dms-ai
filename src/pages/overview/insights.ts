import {
  ChartArea,
  ChartCard,
  TopListCard,
} from "@antelopejs/interface-dms/base";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import {
  OVERVIEW_PERIOD_SCOPE,
  PAGE_ROUTES,
  RECENT_CHANGE_SETS,
  TOP_TOOLS_LIMIT,
} from "../../constants/pages";
import { blockMeta, blockText } from "../meta";
import { recentChangeSets } from "./recent-changes";

const GRID_GAP = "1rem";
const WIDE_COLUMN_SPAN = 2;
const ALLOWED_WAYS = 8;
const ROW_ID = "row";

function activityChart(): ComponentBuilder {
  const path = "overview.activity_chart";
  return ChartCard({
    title: blockText(path, "title"),
    description: blockText(path, "caption"),
    icon: "i-ph-chart-line",
    fetchUrl: PAGE_ROUTES.SERIES,
    periodScope: OVERVIEW_PERIOD_SCOPE,
    valueFormat: "compact",
    primaryLabel: blockText(path, "primary"),
    comparisonLabel: blockText(path, "comparison"),
    chart: ChartArea({ xaxisType: "datetime" }).meta(
      blockMeta("overview.activity_chart_series", "i-ph-chart-line-up"),
    ),
  }).meta(blockMeta(path, "i-ph-chart-line"));
}

function allowedBreakdown(): ComponentBuilder {
  const path = "overview.allowed";
  return TopListCard({
    title: blockText(path, "title"),
    description: blockText(path, "caption"),
    fetchUrl: PAGE_ROUTES.ALLOWED,
    periodScope: OVERVIEW_PERIOD_SCOPE,
    valueFormat: "number",
    showBar: true,
    showDelta: false,
    skeletonCount: ALLOWED_WAYS,
    emptyLabel: blockText(path, "empty"),
  }).meta(blockMeta(path, "i-ph-hand-palm"));
}

function topTools(): ComponentBuilder {
  const path = "overview.top_tools";
  return TopListCard({
    title: blockText(path, "title"),
    description: blockText(path, "caption"),
    fetchUrl: PAGE_ROUTES.TOP_TOOLS,
    periodScope: OVERVIEW_PERIOD_SCOPE,
    valueFormat: "number",
    showRank: true,
    showBar: true,
    showDelta: false,
    skeletonCount: TOP_TOOLS_LIMIT,
    emptyLabel: blockText(path, "empty"),
  }).meta(blockMeta(path, "i-ph-wrench"));
}

/** The activity chart beside how its actions were allowed. */
export function overviewActivity(): ComponentBuilder {
  const row = GridRow()
    .meta(blockMeta("overview.activity_row", "i-ph-rows"))
    .child("chart", activityChart(), { colSpan: WIDE_COLUMN_SPAN })
    .child("allowed", allowedBreakdown());
  return Grid({ gap: GRID_GAP })
    .meta(blockMeta("overview.activity", "i-ph-chart-line"))
    .child(ROW_ID, row);
}

/** The latest change sets, with Undo, beside the tools used most. */
export function overviewChanges(): ComponentBuilder {
  const row = GridRow()
    .meta(blockMeta("overview.changes_row", "i-ph-rows"))
    .child("recentChanges", recentChangeSets(RECENT_CHANGE_SETS), {
      colSpan: WIDE_COLUMN_SPAN,
    })
    .child("topTools", topTools());
  return Grid({ gap: GRID_GAP })
    .meta(blockMeta("overview.changes", "i-ph-git-diff"))
    .child(ROW_ID, row);
}
