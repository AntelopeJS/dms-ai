import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { KpiCard } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";

/**
 * AI Activity — audit log of AI actions. The KPI row reuses the shared dms-base
 * KpiCard (bound to the `/ai/metrics/kpi/*` routes, minus a PeriodSelector so
 * they report the default window). The cards track the human-in-the-loop signal:
 * how many mutating actions the agent proposed, how many were approved/denied,
 * and how many tools failed for real (denials excluded). Only the timeline below
 * is a custom Vue view (`DmsAiActivityView`) fetching `/ai/activity`.
 */
@RegisterPage()
export class AIActivityPage extends PageController(
  "activity",
  {
    displayName: "Activity",
    description: "Audit trail of AI actions",
    icon: "i-ph-clock-counter-clockwise",
    module: "ai",
    order: 1,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static kpis = Grid({ gap: "1rem" }).child(
    "kpiRow",
    GridRow()
      .child(
        "proposed",
        KpiCard({
          title: "Proposed",
          icon: "i-ph-magic-wand",
          fetchUrl: "/ai/metrics/kpi/proposed",
          valueFormat: "compact",
          showDelta: false,
        }),
      )
      .child(
        "approved",
        KpiCard({
          title: "Approved",
          icon: "i-ph-check-circle",
          fetchUrl: "/ai/metrics/kpi/approved",
          valueFormat: "compact",
          showDelta: false,
        }),
      )
      .child(
        "denied",
        KpiCard({
          title: "Denied",
          icon: "i-ph-prohibit",
          fetchUrl: "/ai/metrics/kpi/denied",
          valueFormat: "compact",
          invert: true,
          showDelta: false,
        }),
      )
      .child(
        "errors",
        KpiCard({
          title: "Errors",
          icon: "i-ph-warning-circle",
          fetchUrl: "/ai/metrics/kpi/errors",
          valueFormat: "compact",
          invert: true,
          showDelta: false,
        }),
      ),
  );

  static activity = CustomComponent("DmsAiActivityView").meta({
    name: "Activity",
    icon: "i-ph-clock-counter-clockwise",
  });
}
