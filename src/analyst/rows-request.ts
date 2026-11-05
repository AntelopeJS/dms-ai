import { z } from "zod";
import {
  ARCHIVED_QUERY_KEY,
  DEFAULT_FILTER_MODE,
  FILTER_QUERY_PREFIX,
  RANGE_QUERY_KEYS,
  SEARCH_QUERY_KEY,
  SHOW_ARCHIVED_QUERY_KEY,
  SORT_DIRECTION_QUERY_KEY,
  SORT_KEY_QUERY_KEY,
  SOURCE_URL_TOKEN,
  TABLE_LIST_SUFFIX,
} from "../constants/analyst";
import type { AnalystSource, AnalystTable } from "./layouts";
import { AnalystRefusal } from "./refusal";

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const FILTER_MODE_PATTERN = /([^:]+):(.*)/;

const ArchivedSchema = z.enum(["active", "archived"]);
const RangeSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).optional(),
});

/**
 * Where a rows request reads, as the user: the table's route and the query it
 * is sent, and the rows to keep when that route answers them all at once.
 */
export interface RowsRequest {
  pathAndQuery: string;
  slice?: z.infer<typeof RangeSchema>;
}

function badRequest(reason: string, detail: string): AnalystRefusal {
  return new AnalystRefusal(HTTP_BAD_REQUEST, reason, detail);
}

function notSupported(what: string): AnalystRefusal {
  return badRequest(
    "not_supported",
    `This table's route cannot ${what} its rows: load them with AnalystLoad and ${what} them in AnalystCompute.`,
  );
}

function forwardFilters(
  table: AnalystTable,
  query: URLSearchParams,
  forwarded: URLSearchParams,
): void {
  for (const [key, value] of query) {
    if (!key.startsWith(FILTER_QUERY_PREFIX)) continue;
    const field = key.slice(FILTER_QUERY_PREFIX.length);
    const column = table.columns.find((c) => c.field === field);
    if (column === undefined) {
      throw badRequest(
        "unknown_filter",
        `The table has no column "${field}": filter on a field AnalystDescribePage lists.`,
      );
    }
    if (column.filterModes.length === 0) {
      throw badRequest(
        "not_filterable",
        `The column "${field}" cannot be filtered: load the rows with AnalystLoad and filter them in AnalystCompute.`,
      );
    }
    const mode = FILTER_MODE_PATTERN.exec(value)?.[1] ?? DEFAULT_FILTER_MODE;
    if (!column.filterModes.includes(mode)) {
      throw badRequest(
        "unknown_filter_mode",
        `The column "${field}" filters with ${column.filterModes.join(", ")}, not "${mode}".`,
      );
    }
    forwarded.append(key, value);
  }
}

function forwardSort(
  table: AnalystTable,
  query: URLSearchParams,
  forwarded: URLSearchParams,
): void {
  const sortKey = query.get(SORT_KEY_QUERY_KEY);
  if (sortKey === null) return;
  if (table.source !== undefined && !table.source.sort) {
    throw notSupported("sort");
  }
  if (!table.columns.some((c) => c.field === sortKey && c.sortable)) {
    throw badRequest(
      "not_sortable",
      `The column "${sortKey}" cannot be sorted on.`,
    );
  }
  forwarded.set(SORT_KEY_QUERY_KEY, sortKey);
  const direction = query.get(SORT_DIRECTION_QUERY_KEY);
  if (direction !== null) forwarded.set(SORT_DIRECTION_QUERY_KEY, direction);
}

function forwardSearch(
  table: AnalystTable,
  query: URLSearchParams,
  forwarded: URLSearchParams,
): void {
  const search = query.get(SEARCH_QUERY_KEY);
  if (search === null) return;
  if (table.source !== undefined && !table.source.search) {
    throw notSupported("search");
  }
  forwarded.set(SEARCH_QUERY_KEY, search);
}

function forwardRange(query: URLSearchParams, forwarded: URLSearchParams) {
  for (const key of RANGE_QUERY_KEYS) {
    const value = query.get(key);
    if (value !== null) forwarded.set(key, value);
  }
}

function noArchive(): AnalystRefusal {
  return badRequest(
    "no_archive",
    "This table has no archive: all its rows are active, read it without `archived`.",
  );
}

function showArchived(
  table: AnalystTable,
  query: URLSearchParams,
): "true" | "false" | undefined {
  const asked = query.get(ARCHIVED_QUERY_KEY);
  if (table.archive === undefined) {
    if (asked === null || asked === "active") return undefined;
    throw noArchive();
  }
  const archived = ArchivedSchema.safeParse(asked ?? "active");
  if (!archived.success) {
    throw badRequest("bad_archived", "`archived` is `active` or `archived`.");
  }
  if (archived.data === "active") return "false";
  if (!table.archive.canView) {
    throw new AnalystRefusal(
      HTTP_FORBIDDEN,
      "archive_forbidden",
      "The user may not view this table's archived rows.",
    );
  }
  return "true";
}

function withQuery(location: string, query: URLSearchParams): string {
  const mark = location.indexOf("?");
  if (mark === -1) return `${location}?${query.toString()}`;
  const merged = new URLSearchParams(location.slice(mark + 1));
  for (const [key, value] of query) merged.append(key, value);
  return `${location.slice(0, mark)}?${merged.toString()}`;
}

function sourceRequest(
  source: AnalystSource,
  query: URLSearchParams,
  forwarded: URLSearchParams,
): RowsRequest {
  if (source.fetchUrl.includes(SOURCE_URL_TOKEN)) {
    throw badRequest(
      "not_supported",
      "This table's route depends on the page's URL, which Analyst does not open.",
    );
  }
  if (query.has(ARCHIVED_QUERY_KEY)) throw noArchive();
  if (source.paginate) {
    forwardRange(query, forwarded);
    return { pathAndQuery: withQuery(source.fetchUrl, forwarded) };
  }
  const range = RangeSchema.safeParse({
    offset: query.get("offset") ?? undefined,
    limit: query.get("limit") ?? undefined,
  });
  if (!range.success) {
    throw badRequest("bad_range", "`offset` and `limit` are whole numbers.");
  }
  return {
    pathAndQuery: withQuery(source.fetchUrl, forwarded),
    slice: range.data,
  };
}

/**
 * The request reading one page of a table's rows. A filter, a sort or a
 * search the table does not serve is refused rather than dropped, so a bad
 * one never reads as a valid unfiltered answer. A table in archive mode is
 * always sent which rows it lists, active ones unless `archived` asks for the
 * archived ones; a source table's route is sent only what it handles itself.
 */
export function rowsRequest(
  table: AnalystTable,
  query: URLSearchParams,
): RowsRequest {
  const forwarded = new URLSearchParams();
  forwardFilters(table, query, forwarded);
  forwardSort(table, query, forwarded);
  forwardSearch(table, query, forwarded);
  if (table.source !== undefined) {
    return sourceRequest(table.source, query, forwarded);
  }
  forwardRange(query, forwarded);
  const archived = showArchived(table, query);
  if (archived !== undefined) forwarded.set(SHOW_ARCHIVED_QUERY_KEY, archived);
  return {
    pathAndQuery: `${table.location}${TABLE_LIST_SUFFIX}?${forwarded.toString()}`,
  };
}
