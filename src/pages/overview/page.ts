import { PeriodSelector } from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  OVERVIEW_PERIOD_SCOPE,
  PAGE_IDS,
  PAGE_ORDER,
} from "../../constants/pages";
import { blockMeta, pageMenu } from "../meta";
import { overviewActivity, overviewChanges } from "./insights";
import { overviewKpis } from "./kpis";
import { overviewStatus, overviewStatusBanner } from "./status";

const PERIOD_PATH = "overview.period";

/**
 * AI Overview — the module's landing page: what needs the owner, the
 * assistant's status, what it did over the selected period, how each action
 * was allowed, and the latest change sets with Undo. Every block is a DMS
 * block bound to an `/ai/*` route.
 */
@RegisterPage()
export class AIOverviewPage extends PageController(
  PAGE_IDS.OVERVIEW,
  pageMenu(PAGE_IDS.OVERVIEW, "i-ph-chart-line", PAGE_ORDER.OVERVIEW),
  DefaultLayout(),
) {
  static period = PeriodSelector({
    id: OVERVIEW_PERIOD_SCOPE,
    align: "right",
    variant: "segmented",
    defaultPreset: "last-7-days",
    defaultComparison: "previous-period",
    presets: ["last-24h", "last-7-days", "last-30-days"],
    comparisons: ["none", "previous-period"],
  }).meta(blockMeta(PERIOD_PATH, "i-ph-calendar-blank"));

  static attention = overviewStatusBanner();

  static status = overviewStatus();

  static kpis = overviewKpis();

  static activity = overviewActivity();

  static changes = overviewChanges();
}
