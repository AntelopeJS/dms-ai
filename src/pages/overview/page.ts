import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  ChartArea,
  ChartCard,
  KpiCard,
  PeriodSelector,
  TopListCard,
} from "@antelopejs/interface-dms/base";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";

const SCOPE_ID = "ai-overview";
const COMPARE_LABEL = "vs previous period";

/**
 * AI Overview — landing dashboard for the AI module. Built from the shared DMS
 * dashboard components (KpiCard / ChartCard / TopListCard) bound to the
 * `/ai/metrics/*` routes, scoped to a single PeriodSelector. Like the reference
 * it shows compact stat cards (no sparklines) + a single activity chart + a top
 * skills list, and excludes the "Recent activity", "Needs attention", "Ask
 * AntelopeJS AI" hero and "Avg success rate" cards.
 */
@RegisterPage()
export class AIOverviewPage extends PageController(
  "overview",
  {
    displayName: "Overview",
    description: "AI assistant usage at a glance",
    icon: "i-ph-chart-line",
    module: "ai",
    order: 0,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static periodSelector = PeriodSelector({
    id: SCOPE_ID,
    align: "right",
    defaultPreset: "last-7-days",
    defaultComparison: "previous-period",
    presets: ["today", "last-7-days", "last-30-days"],
    presetLabels: {
      today: "24h",
      "last-7-days": "7d",
      "last-30-days": "30d",
    },
  });

  static kpis = Grid({ gap: "1rem" }).child(
    "kpiRow",
    GridRow()
      .child(
        "actions",
        KpiCard({
          title: "Actions",
          icon: "i-ph-lightning",
          fetchUrl: "/ai/metrics/kpi/actions",
          periodScope: SCOPE_ID,
          valueFormat: "compact",
          compareLabel: COMPARE_LABEL,
        }),
      )
      .child(
        "approved",
        KpiCard({
          title: "Approved",
          icon: "i-ph-check-circle",
          fetchUrl: "/ai/metrics/kpi/approved",
          periodScope: SCOPE_ID,
          valueFormat: "compact",
          compareLabel: COMPARE_LABEL,
        }),
      )
      .child(
        "denied",
        KpiCard({
          title: "Denied",
          icon: "i-ph-prohibit",
          fetchUrl: "/ai/metrics/kpi/denied",
          periodScope: SCOPE_ID,
          valueFormat: "compact",
          invert: true,
          compareLabel: COMPARE_LABEL,
        }),
      ),
  );

  static activityRow = Grid({ gap: "1rem" }).child(
    "row",
    GridRow()
      .child(
        "activityChart",
        ChartCard({
          title: "AI activity",
          description: "Actions over the selected period",
          icon: "i-ph-chart-line",
          fetchUrl: "/ai/metrics/series",
          periodScope: SCOPE_ID,
          valueFormat: "compact",
          chart: ChartArea({ xaxisType: "datetime" }),
        }),
        { colSpan: 2 },
      )
      .child(
        "topSkills",
        TopListCard({
          title: "Top skills",
          description: "Most-used tools over the selected period",
          fetchUrl: "/ai/metrics/top-skills?limit=5",
          periodScope: SCOPE_ID,
        }),
      ),
  );
}
