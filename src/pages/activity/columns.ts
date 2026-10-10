import { DefaultDisplays } from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import type { TableViewSourceColumn } from "@antelopejs/interface-dms/base/table-view/source";
import { I18N_SECTIONS } from "../../constants/i18n";
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_RESULTS,
  AGENTS,
  ALLOWED_BY,
  i18nKey,
  toolOptions,
  type Vocabulary,
  vocabularyOptions,
  vocabularyTones,
} from "../../vocabulary";

const SECTION = I18N_SECTIONS.ACTIVITY;
const TIME_COLUMN_SIZE = 120;
const ACTION_COLUMN_SIZE = 280;
const PILL_COLUMN_SIZE = 190;
const DURATION_COLUMN_SIZE = 120;
/** A call younger than this reads "Just now". */
const JUST_NOW_MS = 60_000;

/** The values the "Read-only" quick filter offers: hiding them. */
const READ_ONLY_OPTIONS = [
  { value: "false", label: i18nKey(SECTION, "read_only", "hide") },
];

function columnName(column: string): string {
  return i18nKey(SECTION, "columns", column);
}

function enumeration(group: string, vocabulary: Vocabulary) {
  return new DefaultDataTypes.SelectType({
    items: vocabularyOptions(SECTION, group, vocabulary),
  });
}

/** The hidden columns the tabs and the quick filters filter on. */
const FILTER_COLUMNS: Record<string, TableViewSourceColumn> = {
  category: {
    name: columnName("category"),
    type: new DefaultDataTypes.SelectType({
      items: vocabularyOptions(SECTION, "category", ACTIVITY_CATEGORIES),
      multiple: true,
    }),
    filterable: true,
    isVisible: false,
    order: 10,
  },
  agent: {
    name: columnName("agent"),
    type: enumeration("agent", AGENTS),
    filterable: true,
    isVisible: false,
    order: 11,
  },
  isReadOnly: {
    name: columnName("read_only"),
    type: new DefaultDataTypes.SelectType({ items: READ_ONLY_OPTIONS }),
    filterable: true,
    isVisible: false,
    order: 12,
  },
};

/** The audit log's columns, as the mockup draws them. */
export const ACTIVITY_COLUMNS: Record<string, TableViewSourceColumn> = {
  timestamp: {
    name: columnName("time"),
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({
      nowWithinMs: JUST_NOW_MS,
    }),
    size: TIME_COLUMN_SIZE,
    order: 1,
  },
  tool: {
    name: columnName("action"),
    type: new DefaultDataTypes.SelectType({ items: toolOptions(SECTION) }),
    display: new DefaultDisplays.TwoLineDisplay({ subField: "actionDetail" }),
    filterable: true,
    size: ACTION_COLUMN_SIZE,
    order: 2,
  },
  allowedBy: {
    name: columnName("allowed"),
    type: enumeration("allowed_by", ALLOWED_BY),
    display: new DefaultDisplays.StatusPillDisplay({
      tones: vocabularyTones(ALLOWED_BY),
    }),
    size: PILL_COLUMN_SIZE,
    order: 3,
  },
  result: {
    name: columnName("result"),
    type: enumeration("result", ACTIVITY_RESULTS),
    display: new DefaultDisplays.StatusPillDisplay({
      tones: vocabularyTones(ACTIVITY_RESULTS),
      subField: "resultDetail",
      liveValues: ["pending"],
    }),
    size: PILL_COLUMN_SIZE,
    order: 4,
  },
  conversationTitle: {
    name: columnName("conversation"),
    type: new DefaultDataTypes.StringType(),
    order: 5,
  },
  durationMs: {
    name: columnName("duration"),
    type: new DefaultDataTypes.NumberType(),
    display: new DefaultDisplays.DurationDisplay(),
    size: DURATION_COLUMN_SIZE,
    order: 6,
  },
  ...FILTER_COLUMNS,
};
