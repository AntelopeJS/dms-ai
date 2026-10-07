import {
  ChartCard,
  ChartColumn,
  Form,
  KeyValueList,
  Section,
} from "@antelopejs/interface-dms/base";
import { FormPageLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { PAGE_IDS, PAGE_ORDER, PAGE_ROUTES } from "../../constants/pages";
import { blockMeta, blockText, pageMenu } from "../meta";
import { lockUnavailableChoices } from "./availability";
import { SETTINGS_SECTIONS } from "./sections";

const USAGE_PATH = "settings.usage";
const USAGE_SUMMARY_ROWS = 3;

const settingsForm = Form({
  fetchUrl: PAGE_ROUTES.SETTINGS,
  submitUrl: PAGE_ROUTES.SETTINGS,
  saveMode: "instant",
  sectionNav: "side",
  sections: SETTINGS_SECTIONS,
})
  .meta(blockMeta("settings.form", "i-ph-sliders"))
  .onFilter(lockUnavailableChoices);

/**
 * AI Settings — the defaults of new conversations (agent, approval mode,
 * scope), what always asks, local skills and checkpoint retention, in one
 * form saving each change on its own to `/ai/settings`; then the tokens the
 * conversations used.
 */
@RegisterPage()
export class AISettingsPage extends PageController(
  PAGE_IDS.SETTINGS,
  pageMenu(PAGE_IDS.SETTINGS, "i-ph-gear-six", PAGE_ORDER.SETTINGS),
  FormPageLayout(),
) {
  static settings = settingsForm;

  static usage = Section({
    title: blockText(USAGE_PATH, "title"),
    description: blockText(USAGE_PATH, "caption"),
    card: false,
  })
    .meta(blockMeta(USAGE_PATH, "i-ph-chart-bar"))
    .child(
      "tokens",
      ChartCard({
        title: blockText("settings.usage_chart", "title"),
        description: blockText("settings.usage_chart", "caption"),
        icon: "i-ph-chart-bar",
        fetchUrl: PAGE_ROUTES.USAGE,
        valueFormat: "compact",
        showDelta: false,
        chart: ChartColumn({ xaxisType: "datetime" }).meta(
          blockMeta("settings.usage_chart_series", "i-ph-chart-bar"),
        ),
      }).meta(blockMeta("settings.usage_chart", "i-ph-chart-bar")),
    )
    .child(
      "summary",
      KeyValueList({
        title: blockText("settings.usage_summary", "title"),
        fetchUrl: PAGE_ROUTES.USAGE_SUMMARY,
        skeletonCount: USAGE_SUMMARY_ROWS,
      }).meta(blockMeta("settings.usage_summary", "i-ph-list-numbers")),
    );
}
