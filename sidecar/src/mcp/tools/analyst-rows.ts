import { z } from "zod";
import type { AnalystClient } from "../../analyst/analyst-client.js";
import {
  ANALYST_DEFAULT_LIMIT,
  ANALYST_PAGE_SIZE,
  ANALYST_ROW_CAP,
  ANALYST_ROWS_PATH,
} from "../../constants/analyst.js";
import { type JsonValue, JsonValueSchema } from "../../protocol/json.js";

export const PAGE = z
  .string()
  .describe("A page path from AnalystListPages, e.g. `/sales/orders`.");
export const TABLE = z
  .string()
  .describe("A table id from AnalystDescribePage.");
const FILTER = z.object({
  field: z.string(),
  mode: z.string().describe("One of the filter modes the column accepts."),
  value: z.string().optional(),
});

const ARCHIVED = z
  .enum(["active", "archived"])
  .describe(
    "On a table with `hasArchive`: `active` (the default) or `archived` rows, never both.",
  );

/** How a table's rows are picked, as AnalystReadRows and AnalystLoad take it. */
export const ROWS_SELECTION = {
  page: PAGE,
  table: TABLE,
  filters: z.array(FILTER).optional(),
  search: z.string().optional(),
  sortField: z.string().optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  archived: ARCHIVED.optional(),
};

const RowsPageSchema = z.object({
  rows: z.array(JsonValueSchema),
  total: z.number(),
});

export interface RowsSelection {
  page: string;
  table: string;
  filters?: Array<z.infer<typeof FILTER>>;
  search?: string;
  sortField?: string;
  sortDirection?: "asc" | "desc";
  archived?: z.infer<typeof ARCHIVED>;
}

interface ReadRowsArgs extends RowsSelection {
  offset?: number;
  limit?: number;
}

/** Rows a table's list route answered, or the route's failure as it came. */
export type PagedRows =
  | { ok: true; rows: JsonValue[]; total: number }
  | { ok: false; answer: JsonValue };

function rowsQuery(args: RowsSelection, offset: number, limit: number) {
  const query = new URLSearchParams({
    page: args.page,
    table: args.table,
    offset: String(offset),
    limit: String(limit),
  });
  if (args.search !== undefined) query.set("search", args.search);
  if (args.archived !== undefined) query.set("archived", args.archived);
  if (args.sortField !== undefined) {
    query.set("sortKey", args.sortField);
    query.set("sortDirection", args.sortDirection ?? "asc");
  }
  for (const filter of args.filters ?? []) {
    query.append(
      `filter_${filter.field}`,
      `${filter.mode}:${filter.value ?? ""}`,
    );
  }
  return query;
}

/**
 * Pages through the table's list route from `start` until `wanted` rows are
 * read or the rows run out.
 */
export async function pageRows(
  client: AnalystClient,
  grant: string,
  selection: RowsSelection,
  range: { start: number; wanted: number },
): Promise<PagedRows> {
  const rows: JsonValue[] = [];
  let total = 0;
  while (rows.length < range.wanted) {
    const size = Math.min(ANALYST_PAGE_SIZE, range.wanted - rows.length);
    const answered = await client.get(
      ANALYST_ROWS_PATH,
      rowsQuery(selection, range.start + rows.length, size),
      grant,
    );
    const page = RowsPageSchema.safeParse(answered);
    if (!page.success) return { ok: false, answer: answered };
    total = page.data.total;
    rows.push(...page.data.rows);
    if (page.data.rows.length < size) break;
    if (range.start + rows.length >= total) break;
  }
  return { ok: true, rows, total };
}

/** AnalystReadRows: a few rows, up to its cap, from `offset`. */
export async function readRows(
  client: AnalystClient,
  grant: string,
  args: ReadRowsArgs,
): Promise<JsonValue> {
  const start = args.offset ?? 0;
  const wanted = Math.min(args.limit ?? ANALYST_DEFAULT_LIMIT, ANALYST_ROW_CAP);
  const read = await pageRows(client, grant, args, { start, wanted });
  if (!read.ok) return read.answer;
  return {
    rows: read.rows,
    total: read.total,
    offset: start,
    isPartial: start > 0 || start + read.rows.length < read.total,
  };
}
