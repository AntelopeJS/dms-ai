import { TableView } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import type { TableViewTab } from "@antelopejs/interface-dms/base/table-view/options";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { I18N_SECTIONS } from "../../constants/i18n";
import {
  ACTIVITY_PAGE_SIZE,
  PAGE_IDS,
  PAGE_ORDER,
  PAGE_ROUTES,
} from "../../constants/pages";
import { ACTIVITY_CATEGORIES, i18nKey } from "../../vocabulary";
import { blockMeta, pageMenu } from "../meta";
import { ACTIVITY_COLUMNS } from "./columns";

const SECTION = I18N_SECTIONS.ACTIVITY;
const TABLE_PATH = "activity.log";

function text(...segments: string[]): string {
  return i18nKey(SECTION, ...segments);
}

const TABS: TableViewTab[] = [
  { id: "all", label: text("tabs", "all"), icon: "i-ph-list" },
  ...Object.entries(ACTIVITY_CATEGORIES).map(([category, entry]) => ({
    id: category,
    label: text("tabs", category),
    icon: entry.icon,
    filter: { accessorKey: "category", mode: "is", value: category },
  })),
];

const DETAIL_DRAWER = CustomComponent("DmsAiActivityDetail").meta(
  blockMeta("activity.detail", "i-ph-sidebar-simple"),
);

/**
 * AI Activity — the audit log: every tool the assistant used, how it was
 * allowed and what came out, from `/ai/activity`. Tabs and quick filters are
 * column filters the route forwards to the sidecar; a row opens its detail in
 * a drawer, deep-linked as `?record=<id>`.
 */
@RegisterPage()
export class AIActivityPage extends PageController(
  PAGE_IDS.ACTIVITY,
  pageMenu(
    PAGE_IDS.ACTIVITY,
    "i-ph-clock-counter-clockwise",
    PAGE_ORDER.ACTIVITY,
  ),
  DefaultLayout({
    headerActions: [
      {
        label: text("export"),
        icon: "i-ph-download-simple",
        target: { type: "external", url: PAGE_ROUTES.ACTIVITY_EXPORT },
      },
    ],
  }),
) {
  static log = TableView.fromSource({
    fetchUrl: PAGE_ROUTES.ACTIVITY,
    capabilities: { search: true, paginate: true, filter: true },
    columns: ACTIVITY_COLUMNS,
    searchPlaceholder: text("search"),
    pageSize: ACTIVITY_PAGE_SIZE,
    pagination: "loadMore",
    tabs: TABS,
    quickFilters: [
      { field: "tool", label: text("quick", "tool"), icon: "i-ph-wrench" },
      { field: "agent", label: text("quick", "agent"), icon: "i-ph-robot" },
      {
        field: "isReadOnly",
        label: text("quick", "read_only"),
        icon: "i-ph-eye-slash",
        allLabel: text("read_only", "show"),
      },
    ],
    rowActions: {
      custom: [
        {
          label: text("detail", "open"),
          icon: "i-ph-sidebar-simple",
          isDefault: true,
          deepLink: true,
          target: {
            type: "drawer",
            component: DETAIL_DRAWER,
            title: text("detail", "title"),
          },
        },
      ],
    },
    footer: { countLabel: text("count") },
    emptyStates: {
      firstRun: {
        title: text("empty", "title"),
        description: text("empty", "description"),
        icon: "i-ph-clock-counter-clockwise",
      },
      error: {
        title: text("offline", "title"),
        description: text("offline", "description"),
        icon: "i-ph-plugs",
      },
    },
  }).meta(blockMeta(TABLE_PATH, "i-ph-clock-counter-clockwise"));
}
