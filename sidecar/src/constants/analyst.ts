export const DATA_GRANT_HEADER = "x-dms-ai-grant";
export const ANALYST_PAGES_PATH = "/ai/analyst/pages";
export const ANALYST_TABLES_PATH = "/ai/analyst/tables";
export const ANALYST_ROWS_PATH = "/ai/analyst/rows";
export const ANALYST_FETCH_TIMEOUT_MS = 30_000;
export const ANALYST_LOG_PREFIX = "[dms-ai analyst]";

/** One list request: the most a table view's list route answers at once. */
export const ANALYST_PAGE_SIZE = 100;
/**
 * The most rows one AnalystReadRows call gathers by paging. Past it the
 * answer says it is partial rather than guessing the rest.
 */
export const ANALYST_ROW_CAP = 200;
export const ANALYST_DEFAULT_LIMIT = 20;

/** The most rows one conversation's datasets hold together. */
export const ANALYST_DATASET_ROW_CAP = 50_000;
/**
 * The rows every conversation's datasets hold together in the sidecar: past
 * it, the datasets used least recently are evicted.
 */
export const ANALYST_SIDECAR_ROW_BUDGET = 200_000;
/** The rows of a loaded dataset AnalystLoad shows the model. */
export const ANALYST_SAMPLE_ROWS = 3;
export const ANALYST_DATASET_NAME_PATTERN = /^[a-z][A-Za-z0-9_]{0,63}$/;
/** What a dataset may not be called: the sandbox's own globals and words. */
export const ANALYST_RESERVED_DATASET_NAMES: ReadonlySet<string> = new Set([
  "datasets",
  "globalThis",
  "undefined",
  "eval",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "escape",
  "unescape",
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

export const ANALYST_COMPUTE_TIMEOUT_MS = 5_000;
export const ANALYST_COMPUTE_MEMORY_BYTES = 256 * 1024 * 1024;
/**
 * The sandbox's stack. QuickJS's frames also use the host's own stack, so a
 * larger one lets deep recursion overflow Node's stack before QuickJS's check.
 */
export const ANALYST_COMPUTE_STACK_BYTES = 256 * 1024;
/** The longest JSON result AnalystCompute hands back, in characters. */
export const ANALYST_COMPUTE_RESULT_CHARS = 20_000;

export const ANALYST_LIST_PAGES_TOOL_NAME = "AnalystListPages";
export const ANALYST_DESCRIBE_PAGE_TOOL_NAME = "AnalystDescribePage";
export const ANALYST_READ_ROWS_TOOL_NAME = "AnalystReadRows";
export const ANALYST_LOAD_TOOL_NAME = "AnalystLoad";
export const ANALYST_COMPUTE_TOOL_NAME = "AnalystCompute";
export const ANALYST_TOOL_NAMES = [
  ANALYST_LIST_PAGES_TOOL_NAME,
  ANALYST_DESCRIBE_PAGE_TOOL_NAME,
  ANALYST_READ_ROWS_TOOL_NAME,
  ANALYST_LOAD_TOOL_NAME,
  ANALYST_COMPUTE_TOOL_NAME,
] as const;

export const ANALYST_LIST_PAGES_DESCRIPTION =
  "Lists the pages of the dashboard the user may open, each with its path, title and description. Titles starting with `$` are translation keys: read them as the words they name.";
export const ANALYST_DESCRIBE_PAGE_DESCRIPTION =
  "Lists the tables a page shows the user, each with its id, whether it can be searched, and its columns: the field, header, type, whether it can be sorted, and the filter modes it accepts. `hasArchive` marks a table that keeps archived rows apart, and `canViewArchived` whether the user may read them. `followsPeriod` marks a table whose rows follow a period picked on the page: Analyst reads its default period, so say so.";
export const ANALYST_READ_ROWS_DESCRIPTION = `Shows a few rows of one table, exactly as the user sees them on that page: only its columns, and only the rows the user may list. Use it to look at examples, never to count, sum or average: load the rows with ${ANALYST_LOAD_TOOL_NAME} and compute with ${ANALYST_COMPUTE_TOOL_NAME} instead. Filter with \`filters\` ({ field, mode, value } using a mode the column accepts), search with \`search\`, sort on a sortable column; a filter, search or sort the table does not serve is refused. On a table with \`hasArchive\`, \`archived: "archived"\` reads the archived rows instead of the active ones. Up to ${ANALYST_ROW_CAP} rows per call, paged from \`offset\`; \`total\` is the number of matching rows.`;
export const ANALYST_LOAD_DESCRIPTION = `Loads the rows of one table, exactly as AnalystReadRows reads them, into a dataset named \`name\` that ${ANALYST_COMPUTE_TOOL_NAME} scripts can use; loading a name again replaces that dataset. Filter, search, sort and pick \`archived\` rows as in AnalystReadRows; \`limit\` caps the rows loaded. The rows are not shown: the answer gives the row count, the matching \`total\`, the column fields and at most ${ANALYST_SAMPLE_ROWS} sample rows. This conversation's datasets hold at most ${ANALYST_DATASET_ROW_CAP} rows together, and a dataset unused for a while may be dropped to free memory: a script then fails naming it, and it must be loaded again. When \`isPartial\` is true the dataset does not hold every matching row: say what the answer covers, or narrow the load.`;
export const ANALYST_COMPUTE_DESCRIPTION = `Runs JavaScript over the datasets loaded with ${ANALYST_LOAD_TOOL_NAME} and returns its result. \`code\` is the body of an async function: end it with \`return <value>\`; the value is returned as JSON, at most ${ANALYST_COMPUTE_RESULT_CHARS} characters, so aggregate rather than return rows. Each dataset is a global array of plain row objects under its name, and \`datasets\` maps every name to its array; each run starts from a fresh copy. Pure computation only: no network, files, modules, timers or console. Limits: ${ANALYST_COMPUTE_TIMEOUT_MS / 1000} s, ${ANALYST_COMPUTE_MEMORY_BYTES / 1024 / 1024} MB. Never paste data into the script: load it.`;

export const BUILDER_REFUSED_MESSAGE =
  "Builder is not available here: this conversation can only run in Analyst mode.";

export const ANALYST_EVICTED_MESSAGE =
  "These datasets were dropped to free memory and must be loaded again:";
