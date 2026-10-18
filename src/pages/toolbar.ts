import {
  PAGE_TOOLBAR_PERIOD_DEFAULTS,
  PageToolbar,
  type PageToolbarProps,
  PeriodSelector,
  type PeriodSelectorProps,
} from "@antelopejs/interface-dms/base";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import { PERIOD_REMEMBER_KEY } from "../constants/pages";
import { blockMeta } from "./meta";

/** Child id of the period selector, as `pageToolbar()` names it. */
const PERIOD_CHILD_ID = "period";
const TOOLBAR_ICON = "i-ph-sliders-horizontal";
const PERIOD_ICON = "i-ph-calendar-blank";

/** Where a page's toolbar is titled, under `$dms_ai.blocks.<page>`. */
export interface PeriodToolbarPaths {
  toolbar: string;
  period: string;
}

/**
 * The DMS page toolbar of a page with a period and no live data: "Updated …
 * ago" with a refresh button, then the period. Built by hand rather than
 * with `pageToolbar()` so the toolbar and its selector carry the module's
 * role-editor titles. Every page shares {@link PERIOD_REMEMBER_KEY}, so the
 * period follows the owner from page to page.
 */
export function periodToolbar(
  paths: PeriodToolbarPaths,
  period: PeriodSelectorProps,
): ComponentBuilder<PageToolbarProps> {
  return PageToolbar()
    .meta(blockMeta(paths.toolbar, TOOLBAR_ICON))
    .child(
      PERIOD_CHILD_ID,
      PeriodSelector({
        ...PAGE_TOOLBAR_PERIOD_DEFAULTS,
        rememberKey: PERIOD_REMEMBER_KEY,
        ...period,
      }).meta(blockMeta(paths.period, PERIOD_ICON)),
    );
}
