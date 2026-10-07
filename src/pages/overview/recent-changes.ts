import { DefaultDisplays, TableView } from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import { ButtonVariant } from "@antelopejs/interface-dms/base/types";
import type { CustomRowAction } from "@antelopejs/interface-dms/base/types/row-action";
import type { TableViewSourceColumn } from "@antelopejs/interface-dms/base/table-view/source";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import { I18N_SECTIONS } from "../../constants/i18n";
import { PAGE_LINKS, PAGE_ROUTES } from "../../constants/pages";
import {
  CHANGE_SCOPES,
  CHANGE_STATES,
  i18nKey,
  vocabularyOptions,
  vocabularyTones,
} from "../../vocabulary";
import { blockMeta, blockText } from "../meta";

const SECTION = I18N_SECTIONS.CHANGES_TABLE;
const NUMBER_COLUMN_SIZE = 56;
const TITLE_COLUMN_SIZE = 240;
const PILL_COLUMN_SIZE = 110;
const DIFFSTAT_COLUMN_SIZE = 120;
const STATE_FIELD = "state";

function text(...segments: string[]): string {
  return i18nKey(SECTION, ...segments);
}

const COLUMNS: Record<string, TableViewSourceColumn> = {
  number: {
    name: text("columns", "number"),
    type: new DefaultDataTypes.NumberType(),
    display: new DefaultDisplays.MonoDisplay(),
    size: NUMBER_COLUMN_SIZE,
    order: 1,
  },
  title: {
    name: text("columns", "title"),
    type: new DefaultDataTypes.StringType(),
    size: TITLE_COLUMN_SIZE,
    order: 2,
  },
  scope: {
    name: text("columns", "scope"),
    type: new DefaultDataTypes.SelectType({
      items: vocabularyOptions(SECTION, "scope", CHANGE_SCOPES),
    }),
    display: new DefaultDisplays.StatusPillDisplay({
      tones: vocabularyTones(CHANGE_SCOPES),
    }),
    filterable: true,
    size: PILL_COLUMN_SIZE,
    order: 3,
  },
  diffstat: {
    name: text("columns", "files"),
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.MonoDisplay(),
    size: DIFFSTAT_COLUMN_SIZE,
    order: 4,
  },
  createdAt: {
    name: text("columns", "when"),
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay(),
    size: DIFFSTAT_COLUMN_SIZE,
    order: 5,
  },
  state: {
    name: text("columns", "state"),
    type: new DefaultDataTypes.SelectType({
      items: vocabularyOptions(SECTION, STATE_FIELD, CHANGE_STATES),
    }),
    display: new DefaultDisplays.StatusPillDisplay({
      tones: vocabularyTones(CHANGE_STATES),
      subField: "stateDetail",
    }),
    filterable: true,
    size: PILL_COLUMN_SIZE,
    order: 6,
  },
};

const ROW_ACTIONS: CustomRowAction[] = [
  {
    label: text("actions", "open"),
    icon: "i-ph-git-diff",
    isDefault: true,
    target: { type: "page", url: PAGE_LINKS.CHANGE_SET },
  },
  {
    label: text("actions", "undo"),
    icon: "i-ph-arrow-counter-clockwise",
    isVisible: true,
    showLabel: true,
    variant: ButtonVariant.outline,
    rule: { field: STATE_FIELD, equals: "applied" },
    confirm: { from: PAGE_ROUTES.CHANGE_UNDO_CONFIRM },
    target: {
      type: "api",
      url: PAGE_ROUTES.CHANGE_UNDO,
      method: "POST",
      successMessage: text("toasts", "undone"),
    },
  },
  {
    label: text("actions", "redo"),
    icon: "i-ph-arrow-clockwise",
    isVisible: true,
    showLabel: true,
    variant: ButtonVariant.outline,
    rule: { field: STATE_FIELD, equals: "undone" },
    target: {
      type: "api",
      url: PAGE_ROUTES.CHANGE_REDO,
      method: "POST",
      successMessage: text("toasts", "redone"),
    },
  },
];

/** The latest change sets of the project, each with Undo or Redo. */
export function recentChangeSets(rows: number): ComponentBuilder {
  const path = "overview.recent_changes";
  return TableView.fromSource({
    caption: blockText(path, "title"),
    fetchUrl: PAGE_ROUTES.CHANGES,
    capabilities: { paginate: true, filter: true },
    columns: COLUMNS,
    labelKey: "title",
    pageSize: rows,
    density: "compact",
    rowActions: { custom: ROW_ACTIONS },
    customButtons: [
      {
        label: text("actions", "all_changes"),
        icon: "i-ph-arrow-right",
        variant: ButtonVariant.ghost,
        target: { type: "page", url: PAGE_LINKS.CHANGES },
      },
    ],
    emptyStates: {
      firstRun: {
        title: text("empty", "title"),
        description: text("empty", "description"),
        icon: "i-ph-git-diff",
      },
      error: {
        title: text("offline", "title"),
        description: text("offline", "description"),
        icon: "i-ph-plugs",
      },
    },
  }).meta(blockMeta(path, "i-ph-git-diff"));
}
