import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { PAGE_IDS, PAGE_ORDER } from "../../constants/pages";
import { blockMeta, pageMenu } from "../meta";

/**
 * AI Changes — every turn that touched the project, saved as a change set with
 * a checkpoint: the list, the selected set's diff, and Undo with its conflict
 * preview. A master-detail no DMS block draws, so one custom view fed by
 * `/ai/changes*`; `?set=<id>` opens a set.
 */
@RegisterPage()
export class AIChangesPage extends PageController(
  PAGE_IDS.CHANGES,
  pageMenu(PAGE_IDS.CHANGES, "i-ph-git-diff", PAGE_ORDER.CHANGES),
  DefaultLayout(),
) {
  static changes = CustomComponent("DmsAiChangesView").meta(
    blockMeta("changes.view", "i-ph-git-diff"),
  );
}
