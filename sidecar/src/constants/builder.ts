export const SIDECAR_BUILDER_FLAG = "--builder-enabled";
export const BUILDER_OP_PATH = "/ai/builder/op";
/** What the backend route answers for an operation the installed Builder interface does not export. */
export const BUILDER_UNKNOWN_OP = "unknown_op";
export const BUILDER_FETCH_TIMEOUT_MS = 15_000;

/**
 * Builder operations that write many files and typecheck the project once, so they outlast the
 * default wait. Mapping twelve tables takes minutes; abandoning it at 15 s left the write running
 * in the backend while the assistant retried against it.
 */
export const BUILDER_SLOW_OP_TIMEOUTS_MS = new Map([
  ["MapResources", 10 * 60_000],
  ["ConfigureProject", 2 * 60_000],
  ["AddModule", 2 * 60_000],
  ["CreateLocalModule", 2 * 60_000],
  ["CreateResource", 60_000],
  ["DeleteResource", 60_000],
  ["ConfigureTableView", 60_000],
]);
export const BUILDER_LOG_PREFIX = "[builder]";

/** The names of every Builder MCP tool. */
export const BUILDER_TOOL_NAMES = [
  "builder_catalog",
  "builder_list_pages",
  "builder_page_structure",
  "builder_create_page",
  "builder_configure_page",
  "builder_delete_page",
  "builder_add_block",
  "builder_compose_page",
  "builder_configure_block",
  "builder_configure_table_view",
  "builder_move_block",
  "builder_remove_block",
  "builder_create_category",
  "builder_configure_category",
  "builder_delete_category",
  "builder_refresh",
  "builder_create_resource",
  "builder_delete_resource",
  "builder_list_resources",
  "builder_resource_structure",
  "builder_add_field",
  "builder_configure_field",
  "builder_remove_field",
  "builder_query_templates",
  "builder_add_query",
  "builder_preview_query",
  "builder_configure_query",
  "builder_remove_query",
  "builder_configure_project",
  "builder_map_resources",
  "builder_analyse_database",
  "builder_mapping",
] as const;

export const BUILDER_CONFIGURE_PROJECT_TOOL_NAME = "builder_configure_project";
export const BUILDER_MAP_RESOURCES_TOOL_NAME = "builder_map_resources";
/** The Builder operation that answers which pages a mapping would remove, writing nothing. */
export const BUILDER_PREVIEW_MAP_RESOURCES_OP = "PreviewMapResources";
/** The key the gate reads the pages a mapping would remove from, for the approval card. */
export const PAGES_TO_REMOVE_ARG = "pagesToRemove";
export const BUILDER_ANALYSE_DATABASE_TOOL_NAME = "builder_analyse_database";
export const BUILDER_MAPPING_TOOL_NAME = "builder_mapping";
/** How long builder_analyse_database waits for the analysis before answering its progress. */
export const BUILDER_ANALYSIS_WAIT_MS = 60_000;
export const BUILDER_ANALYSIS_POLL_MS = 1_000;

/**
 * The catalog's sections listed one line per entry by default; the agent names
 * the entries whose full schema it needs.
 */
export const BUILDER_CATALOG_SECTIONS = ["blocks", "dataTypes"] as const;
export type BuilderCatalogSection = (typeof BUILDER_CATALOG_SECTIONS)[number];

export const BUILDER_CATALOG_DETAIL_HINT =
  'This is the index. Call builder_catalog again with `blocks: ["<type>", …]` and/or `dataTypes: ["<id>", …]` for the full config schema of the entries you will use.';
