import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { pageToolbar } from "@antelopejs/interface-dms/base/page-toolbar";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  OVERVIEW_PERIOD_SCOPE,
  PAGE_IDS,
  PAGE_ORDER,
  PERIOD_REMEMBER_KEY,
} from "../../constants/pages";
import { blockMeta, PERIOD_ICON, pageMenu, TOOLBAR_ICON } from "../meta";
import { overviewActivity, overviewChanges } from "./insights";
import { overviewKpis } from "./kpis";
import { overviewStatus, overviewStatusBanner } from "./status";

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
  /** No live data: "Updated … ago" with a refresh button, then the period. */
  static toolbar = pageToolbar({
    live: false,
    period: {
      id: OVERVIEW_PERIOD_SCOPE,
      rememberKey: PERIOD_REMEMBER_KEY,
      defaultPreset: "last-7-days",
      presets: ["last-24h", "last-7-days", "last-30-days"],
      comparisons: ["previous-period", "previous-year", "none"],
      meta: blockMeta("overview.period", PERIOD_ICON),
    },
  }).meta(blockMeta("overview.toolbar", TOOLBAR_ICON));

  static attention = overviewStatusBanner();

  static status = overviewStatus();

  static kpis = overviewKpis();

  static activity = overviewActivity();

  static changes = overviewChanges();
}
