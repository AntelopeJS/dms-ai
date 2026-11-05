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

/** Query keys of a rows request handed on to the table's list route. */
export const LIST_QUERY_KEYS = [
  "offset",
  "limit",
  "sortKey",
  "sortDirection",
  "search",
] as const;
export const FILTER_QUERY_PREFIX = "filter_";
