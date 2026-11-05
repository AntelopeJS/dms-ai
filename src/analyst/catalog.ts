import { z } from "zod";
import type { GrantIdentity } from "../assistant/grants";
import {
  FILTER_QUERY_PREFIX,
  LIST_QUERY_KEYS,
  ROW_ID_FIELD,
  SITE_LAYOUT_PATH,
  TABLE_LIST_SUFFIX,
} from "../constants/analyst";
import { getAsUser } from "./as-user";
import {
  type AnalystPage,
  type AnalystTable,
  PageLayoutSchema,
  readablePages,
  servedTables,
  SiteLayoutSchema,
} from "./layouts";

const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;

/** A DMS route refused, or Analyst found nothing under the name it was given. */
export class AnalystRefusal extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(reason);
  }
}

async function readAsUser<T>(
  identity: GrantIdentity,
  pathAndQuery: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const answer = await getAsUser(identity, pathAndQuery, schema);
  if (!answer.isOk) {
    throw new AnalystRefusal(answer.status, `dms_refused:${answer.status}`);
  }
  return answer.body;
}

export async function listPages(
  identity: GrantIdentity,
): Promise<AnalystPage[]> {
  return readablePages(
    await readAsUser(identity, SITE_LAYOUT_PATH, SiteLayoutSchema),
  );
}

async function findPage(
  identity: GrantIdentity,
  path: string,
): Promise<AnalystPage> {
  const page = (await listPages(identity)).find((p) => p.path === path);
  if (page === undefined) throw new AnalystRefusal(HTTP_NOT_FOUND, "no_page");
  return page;
}

export async function describePage(
  identity: GrantIdentity,
  path: string,
): Promise<{ page: AnalystPage; tables: AnalystTable[] }> {
  const page = await findPage(identity, path);
  const layout = await readAsUser(identity, page.layoutUrl, PageLayoutSchema);
  return { page, tables: servedTables(layout) };
}

function listQuery(table: AnalystTable, query: URLSearchParams): string {
  const forwarded = new URLSearchParams();
  for (const key of LIST_QUERY_KEYS) {
    const value = query.get(key);
    if (value !== null) forwarded.set(key, value);
  }
  const sortKey = forwarded.get("sortKey");
  if (
    sortKey !== null &&
    !table.columns.some((c) => c.field === sortKey && c.sortable)
  ) {
    throw new AnalystRefusal(HTTP_BAD_REQUEST, "not_sortable");
  }
  for (const column of table.columns) {
    if (column.filterModes.length === 0) continue;
    for (const value of query.getAll(`${FILTER_QUERY_PREFIX}${column.field}`)) {
      forwarded.append(`${FILTER_QUERY_PREFIX}${column.field}`, value);
    }
  }
  return forwarded.toString();
}

const RowSchema = z.record(z.string(), z.json());
type Row = z.infer<typeof RowSchema>;

const ListAnswerSchema = z.object({
  results: z.array(RowSchema),
  total: z.number(),
  offset: z.number().optional().catch(undefined),
  limit: z.number().optional().catch(undefined),
});

/** What a rows request answers: one page of rows, as the user sees them. */
export interface AnalystRows {
  rows: Row[];
  total: number;
  offset: number;
  limit?: number;
}

function project(row: Row, fields: Set<string>): Row {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => fields.has(key)),
  );
}

/**
 * One page of a table view's rows through its own list route, as the user:
 * only filters on the columns it serves, a sort only on a sortable one, and
 * only the fields of its listed columns in each row.
 */
export async function readRows(
  identity: GrantIdentity,
  path: string,
  tableId: string,
  query: URLSearchParams,
): Promise<AnalystRows> {
  const { tables } = await describePage(identity, path);
  const table = tables.find((t) => t.id === tableId);
  if (table === undefined) throw new AnalystRefusal(HTTP_NOT_FOUND, "no_table");
  const answer = await readAsUser(
    identity,
    `${table.location}${TABLE_LIST_SUFFIX}?${listQuery(table, query)}`,
    ListAnswerSchema,
  );
  const fields = new Set([ROW_ID_FIELD, ...table.columns.map((c) => c.field)]);
  return {
    rows: answer.results.map((row) => project(row, fields)),
    total: answer.total,
    offset: answer.offset ?? 0,
    limit: answer.limit,
  };
}
