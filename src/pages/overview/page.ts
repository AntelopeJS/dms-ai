import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  OVERVIEW_PERIOD_SCOPE,
  PAGE_IDS,
  PAGE_ORDER,
} from "../../constants/pages";
import { pageMenu } from "../meta";
import { periodToolbar } from "../toolbar";
import { overviewActivity, overviewChanges } from "./insights";
import { overviewKpis } from "./kpis";
import { overviewStatus, overviewStatusBanner } from "./status";

const TOOLBAR_PATHS = {
  toolbar: "overview.toolbar",
  period: "overview.period",
};

/**
 * AI Overview — the module's landing page: the page toolbar with its
 * period, what needs the owner, the assistant's status, what it did over
 * that period, how each action was allowed, and the latest change sets with
 * Undo. Every block is a DMS block bound to an `/ai/*` route.
 */
@RegisterPage()
export class AIOverviewPage extends PageController(
  PAGE_IDS.OVERVIEW,
  pageMenu(PAGE_IDS.OVERVIEW, "i-ph-chart-line", PAGE_ORDER.OVERVIEW),
  DefaultLayout(),
) {
  static toolbar = periodToolbar(TOOLBAR_PATHS, {
    id: OVERVIEW_PERIOD_SCOPE,
    defaultPreset: "last-7-days",
    defaultComparison: "previous-period",
    // The activity chart has one point per day: an hour would draw one point.
    presets: ["last-24h", "last-7-days", "last-30-days"],
    comparisons: ["previous-period", "previous-year", "none"],
    // A menu, not the toolbar's hidden comparison: the owner picks what the
    // deltas and the chart's dashed line measure against, or none at all.
    comparisonControl: "menu",
  });

  static attention = overviewStatusBanner();

  static status = overviewStatus();

  static kpis = overviewKpis();

  static activity = overviewActivity();

  static changes = overviewChanges();
}
