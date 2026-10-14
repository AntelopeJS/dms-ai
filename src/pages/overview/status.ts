import { Banner, Card, KeyValueList } from "@antelopejs/interface-dms/base";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import { PAGE_LINKS, PAGE_ROUTES } from "../../constants/pages";
import { blockMeta, blockText } from "../meta";

const STATUS_PATH = "overview.status";
const FACTS_PATH = "overview.status_facts";
const FACT_COLUMNS = 3;
/** State, agent, scope, approvals, Builder and sidecar. */
const FACT_ROWS = 6;

/**
 * What needs the owner: the assistant offline (with Restart), its last turn
 * failed, or requests waiting. Nothing when all is well.
 */
export function overviewStatusBanner(): ComponentBuilder {
  return Banner({ fetchUrl: PAGE_ROUTES.STATUS_BANNER }).meta(
    blockMeta("overview.status_banner", "i-ph-bell-ringing"),
  );
}

/** The assistant's state, agent, default scope, approvals, Builder, sidecar. */
export function overviewStatus(): ComponentBuilder {
  const facts = KeyValueList({
    fetchUrl: PAGE_ROUTES.STATUS_FACTS,
    card: false,
    columns: FACT_COLUMNS,
    skeletonCount: FACT_ROWS,
  }).meta(blockMeta(FACTS_PATH, "i-ph-list-dashes"));
  return Card({
    title: blockText(STATUS_PATH, "title"),
    actions: [
      {
        label: blockText(STATUS_PATH, "settings"),
        to: PAGE_LINKS.SETTINGS,
        icon: "i-ph-gear-six",
        variant: "ghost",
      },
    ],
  })
    .meta(blockMeta(STATUS_PATH, "i-ph-pulse"))
    .child("facts", facts);
}
