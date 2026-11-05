/** Where the backend reaches its own API when the module config names no origin. */
export const DMS_LOCAL_BASE_URL = "http://localhost:5010";

export const SITE_LAYOUT_PATH = "/dms/sitelayout";
export const TABLE_VIEW_COMPONENT_NAME = "dms-table-view";
export const TABLE_LIST_SUFFIX = "/list";
export const ROW_ID_FIELD = "_id";
/** A page path with a parameter needs a record to show, so Analyst skips it. */
export const ROUTE_PARAM_MARK = ":";

export const ANALYST_ROUTE_PREFIX = "/analyst";
export const ANALYST_PAGES_PATH = `${ANALYST_ROUTE_PREFIX}/pages`;
export const ANALYST_TABLES_PATH = `${ANALYST_ROUTE_PREFIX}/tables`;
export const ANALYST_ROWS_PATH = `${ANALYST_ROUTE_PREFIX}/rows`;

/** The page of rows a rows request asks for, as the list route reads it. */
export const RANGE_QUERY_KEYS = ["offset", "limit"] as const;
export const SORT_KEY_QUERY_KEY = "sortKey";
export const SORT_DIRECTION_QUERY_KEY = "sortDirection";
export const SEARCH_QUERY_KEY = "search";
export const FILTER_QUERY_PREFIX = "filter_";
/** The rows-request key picking a table's active or archived rows. */
export const ARCHIVED_QUERY_KEY = "archived";
/** The list route's own key for it, which archive mode reads. */
export const SHOW_ARCHIVED_QUERY_KEY = "showArchived";
/** What the list route reads a filter without a mode as. */
export const DEFAULT_FILTER_MODE = "eq";
/** A source `fetchUrl` naming its page's parameters or query, as `{{params.id}}`. */
export const SOURCE_URL_TOKEN = "{{";
