import { z } from "zod";

const COLUMN = z
  .string()
  .describe("A column name as BuilderResourceStructure lists it.");

const DISPLAY = z.enum(["table", "kanban", "cards", "grouped"]);

const KANBAN = z.object({
  groupBy: COLUMN.describe(
    "A single-choice column: a select that is not multiple, a boolean or a status.",
  ),
  draggable: z.boolean().optional(),
});

const GROUPED = z.object({
  groupBy: COLUMN.describe(
    "A sortable column; `day` and `week` need a date column.",
  ),
  by: z.enum(["value", "day", "week"]).optional(),
  collapsible: z.boolean().optional(),
  count: z.boolean().optional().describe("Needs a filterable groupBy column."),
});

const CARDS = z.object({
  fields: z
    .array(COLUMN)
    .optional()
    .describe(
      "Listable columns shown under the card's title; the first few by default.",
    ),
});

const VIEW_FILTER = z.object({
  column: COLUMN.describe("A filterable column."),
  mode: z
    .enum([
      "is",
      "is_not",
      "include",
      "exclude",
      "contains",
      "not_contains",
      "greater_than",
      "less_than",
      "greater_than_or_equal_to",
      "less_than_or_equal_to",
      "is_empty",
      "is_not_empty",
    ])
    .optional()
    .describe("`is` by default."),
  value: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      "A list is joined with commas. Tokens: `{{user.id}}`, `{{now}}`, `{{now-7d}}`, `{{now+14d}}`.",
    ),
});

const VIEW = z.object({
  id: z.string().describe("Lower-case words joined by dashes: `late-orders`."),
  label: z.string(),
  icon: z.string().optional(),
  count: z.boolean().optional().describe("Shows how many rows the view lists."),
  filters: z.array(VIEW_FILTER).optional(),
  search: z.string().optional(),
  sort: z
    .array(
      z.object({
        column: COLUMN.describe("A sortable column."),
        desc: z.boolean().optional(),
      }),
    )
    .optional(),
  columns: z
    .object({
      visible: z.array(COLUMN).optional(),
      hidden: z.array(COLUMN).optional(),
      order: z.array(COLUMN).optional(),
    })
    .optional(),
  display: DISPLAY.optional().describe("One of the displays the table offers."),
  density: z.enum(["default", "compact"]).optional(),
});

const VIEWS = z.object({
  items: z.array(VIEW),
  layout: z.enum(["tabs", "strip", "menu"]).optional(),
  defaultView: z
    .string()
    .optional()
    .describe("The id of the view opened on arrival."),
  userViews: z.boolean().optional(),
});

const FOOTER_SUMMARY = z.object({
  label: z.string().describe("Shown before the figure: `Revenue`."),
  op: z.enum(["sum", "count"]),
  field: COLUMN.optional().describe(
    "The number or price column a `sum` adds up.",
  ),
  where: z
    .object({
      column: COLUMN,
      op: z.enum(["equals", "notEquals", "in", "notIn"]),
      value: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.union([z.string(), z.number(), z.boolean()])),
      ]),
    })
    .optional()
    .describe(
      "Only the rows where the column compares to the value are summed or counted.",
    ),
});

/** What the Builder sets on a table page; shared by BuilderConfigureTableView and the mapping's `tableOptions`. */
export const TABLE_VIEW_SETTINGS = {
  kanban: KANBAN.nullable()
    .optional()
    .describe("A board, one column per value; `null` removes it."),
  grouped: GROUPED.nullable()
    .optional()
    .describe("Rows under group headers; `null` removes it."),
  cards: CARDS.nullable()
    .optional()
    .describe("A card per row; `null` stops offering it."),
  defaultDisplay: DISPLAY.nullable()
    .optional()
    .describe(
      "The display shown first, one the table offers; `null` goes back to the first offered.",
    ),
  views: VIEWS.nullable()
    .optional()
    .describe("Named views of the table; `null` removes them."),
  footer: z
    .object({ summary: z.array(FOOTER_SUMMARY).optional() })
    .nullable()
    .optional()
    .describe(
      "Footer figures; an empty `summary` removes them, `null` removes the footer.",
    ),
};
