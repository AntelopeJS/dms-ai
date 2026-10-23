import { TableView } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { pageToolbar } from "@antelopejs/interface-dms/base/page-toolbar";
import type { TableViewTab } from "@antelopejs/interface-dms/base/table-view/options";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { I18N_SECTIONS } from "../../constants/i18n";
import {
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_PERIOD_SCOPE,
  PAGE_IDS,
  PAGE_ORDER,
  PAGE_ROUTES,
  PERIOD_REMEMBER_KEY,
} from "../../constants/pages";
import { ACTIVITY_CATEGORIES, i18nKey } from "../../vocabulary";
import {
  blockMeta,
  PERIOD_ICON,
  pageMenu,
  ROW_DRAWER_DIRECTION,
  TOOLBAR_ICON,
} from "../meta";
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
 * allowed and what came out, from `/ai/activity`, over the period of the page
 * toolbar. Tabs and quick filters are column filters the route forwards to
 * the sidecar, as is the period; a row opens its detail in a drawer,
 * deep-linked as `?record=<id>`.
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
        target: { type: "download", url: PAGE_ROUTES.ACTIVITY_EXPORT },
      },
    ],
  }),
) {
  // No live data: "Updated … ago" with a refresh button, then the period.
  static toolbar = pageToolbar({
    live: false,
    period: {
      id: ACTIVITY_PERIOD_SCOPE,
      rememberKey: PERIOD_REMEMBER_KEY,
      // The whole log by default, as before the page had a period; an audit
      // log has nothing to compare against.
      defaultPreset: "all",
      presets: ["last-24h", "last-7-days", "last-30-days", "all"],
      comparisons: ["none"],
      meta: blockMeta("activity.period", PERIOD_ICON),
    },
  }).meta(blockMeta("activity.toolbar", TOOLBAR_ICON));

  static log = TableView.fromSource({
    fetchUrl: PAGE_ROUTES.ACTIVITY,
    periodScope: ACTIVITY_PERIOD_SCOPE,
    capabilities: { search: true, paginate: true, filter: true },
    columns: ACTIVITY_COLUMNS,
    searchPlaceholder: text("search"),
    pageSize: ACTIVITY_PAGE_SIZE,
    pagination: "loadMore",
    // A click opens the row's detail drawer, as the audit log is read row
    // after row; the default double-click left a single click inert.
    rowClick: "single",
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
            direction: ROW_DRAWER_DIRECTION,
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
