import { z } from "zod";
import type { GrantIdentity } from "../assistant/grants";
import { ROW_ID_FIELD, SITE_LAYOUT_PATH } from "../constants/analyst";
import { getAsUser } from "./as-user";
import {
  type AnalystPage,
  type AnalystTable,
  PageLayoutSchema,
  readablePages,
  servedTables,
  SiteLayoutSchema,
} from "./layouts";
import { AnalystRefusal } from "./refusal";
import { rowsRequest } from "./rows-request";

const HTTP_NOT_FOUND = 404;

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
 * One page of a table view's rows through its own list route, or a source
 * table's route, as the user: only filters on the columns it serves, a sort
 * only on a sortable one, and only the fields of its listed columns in each
 * row. A source route that answers every row at once is sliced here.
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
  const request = rowsRequest(table, query);
  const answer = await readAsUser(
    identity,
    request.pathAndQuery,
    ListAnswerSchema,
  );
  const fields = new Set([ROW_ID_FIELD, ...table.columns.map((c) => c.field)]);
  const { slice } = request;
  const results =
    slice === undefined
      ? answer.results
      : answer.results.slice(
          slice.offset,
          slice.limit === undefined ? undefined : slice.offset + slice.limit,
        );
  return {
    rows: results.map((row) => project(row, fields)),
    total: answer.total,
    offset: slice?.offset ?? answer.offset ?? 0,
    limit: slice?.limit ?? answer.limit,
  };
}
