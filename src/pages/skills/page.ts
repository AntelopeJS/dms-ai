import { DefaultDisplays, TableView } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import type { TableViewSourceColumn } from "@antelopejs/interface-dms/base/table-view/source";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { I18N_SECTIONS } from "../../constants/i18n";
import {
  PAGE_IDS,
  PAGE_LINKS,
  PAGE_ORDER,
  PAGE_ROUTES,
} from "../../constants/pages";
import {
  i18nKey,
  SKILL_SOURCES,
  vocabularyOptions,
  vocabularyTones,
} from "../../vocabulary";
import { blockMeta, pageMenu } from "../meta";

const SECTION = I18N_SECTIONS.SKILLS;
const CARDS_DISPLAY = "cards";
const NAME_COLUMN_SIZE = 220;
/** Six rows of four cards. */
const CARDS_PAGE_SIZE = 24;

function text(...segments: string[]): string {
  return i18nKey(SECTION, ...segments);
}

const COLUMNS: Record<string, TableViewSourceColumn> = {
  name: {
    name: text("columns", "name"),
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.MonoDisplay(),
    size: NAME_COLUMN_SIZE,
    sortable: true,
    order: 1,
  },
  description: {
    name: text("columns", "description"),
    type: new DefaultDataTypes.StringType(),
    order: 2,
  },
  source: {
    name: text("columns", "source"),
    type: new DefaultDataTypes.SelectType({
      items: vocabularyOptions(SECTION, "source", SKILL_SOURCES),
    }),
    display: new DefaultDisplays.StatusPillDisplay({
      tones: vocabularyTones(SKILL_SOURCES),
      subField: "origin",
    }),
    filterable: true,
    order: 3,
  },
  uses30d: {
    name: text("columns", "uses"),
    type: new DefaultDataTypes.NumberType(),
    sortable: true,
    order: 4,
  },
  lastUsedAt: {
    name: text("columns", "last_used"),
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({
      emptyLabel: text("never_used"),
    }),
    sortable: true,
    order: 5,
  },
};

/**
 * AI Skills — the SKILL.md files loaded into the agent, contributed by the
 * loaded modules and, when allowed, by this machine. A source table on
 * `/ai/skills/catalog` shown as cards, each opening the skill in a drawer;
 * the duplicate-name warning above it is fed by `/ai/skills/conflicts`.
 */
@RegisterPage()
export class AISkillsPage extends PageController(
  PAGE_IDS.SKILLS,
  pageMenu(PAGE_IDS.SKILLS, "i-ph-books", PAGE_ORDER.SKILLS),
  DefaultLayout({
    headerActions: [
      {
        label: text("settings_link"),
        icon: "i-ph-gear-six",
        target: { type: "page", url: PAGE_LINKS.SKILL_SETTINGS },
      },
    ],
  }),
) {
  static conflicts = CustomComponent("DmsAiSkillConflicts").meta(
    blockMeta("skills.conflicts", "i-ph-warning"),
  );

  static catalog = TableView.fromSource({
    fetchUrl: PAGE_ROUTES.SKILLS_CATALOG,
    capabilities: { filter: true },
    columns: COLUMNS,
    labelKey: "name",
    searchPlaceholder: text("search"),
    displays: [{ id: CARDS_DISPLAY }],
    defaultDisplay: CARDS_DISPLAY,
    pageSize: CARDS_PAGE_SIZE,
    defaultSort: { field: "uses30d", desc: true },
    card: {
      component: CustomComponent("DmsAiSkillCard").meta(
        blockMeta("skills.card", "i-ph-cards"),
      ),
    },
    tabs: [
      { id: "all", label: text("tabs", "all"), icon: "i-ph-books" },
      ...Object.entries(SKILL_SOURCES).map(([source, entry]) => ({
        id: source,
        label: text("tabs", source),
        icon: entry.icon,
        filter: { accessorKey: "source", mode: "is", value: source },
      })),
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
            component: CustomComponent("DmsAiSkillDetail").meta(
              blockMeta("skills.detail", "i-ph-sidebar-simple"),
            ),
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
        icon: "i-ph-books",
        actions: [
          { label: text("empty", "action"), to: PAGE_LINKS.SKILL_SETTINGS },
        ],
      },
      error: {
        title: text("offline", "title"),
        description: text("offline", "description"),
        icon: "i-ph-plugs",
      },
    },
  }).meta(blockMeta("skills.catalog", "i-ph-books"));
}
