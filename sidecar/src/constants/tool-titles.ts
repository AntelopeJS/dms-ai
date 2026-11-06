/**
 * The human-readable title of every MCP tool dms-ai serves, keyed by its
 * snake_case name. MCP clients show the title; the model calls the name.
 */
export const MCP_TOOL_TITLES = {
  get_current_page: "Get current page",
  navigate_to_page: "Navigate to page",
  find_pages_using: "Find pages using a file",
  list_pages: "List pages",
  ask_user: "Ask the user",
  preview_blocks: "Preview blocks",
  typecheck: "Typecheck",
  query_logs: "Query logs",
  database_connections: "List database connections",
  database_relations: "List database relations",
  database_describe: "Describe database relations",
  database_profile: "Profile a database relation",
  builder_catalog: "Builder catalog",
  builder_list_pages: "List Builder pages",
  builder_page_structure: "Builder page structure",
  builder_create_page: "Create page",
  builder_configure_page: "Configure page",
  builder_delete_page: "Delete page",
  builder_add_block: "Add block",
  builder_compose_page: "Compose page",
  builder_configure_block: "Configure block",
  builder_configure_table_view: "Configure table view",
  builder_move_block: "Move block",
  builder_remove_block: "Remove block",
  builder_create_category: "Create category",
  builder_configure_category: "Configure category",
  builder_delete_category: "Delete category",
  builder_refresh: "Refresh the Builder",
  builder_create_resource: "Create resource",
  builder_delete_resource: "Delete resource",
  builder_list_resources: "List resources",
  builder_resource_structure: "Resource structure",
  builder_add_field: "Add field",
  builder_configure_field: "Configure field",
  builder_remove_field: "Remove field",
  builder_query_templates: "Query templates",
  builder_add_query: "Add query",
  builder_preview_query: "Preview query",
  builder_configure_query: "Configure query",
  builder_remove_query: "Remove query",
  builder_configure_project: "Configure project",
  builder_map_resources: "Map resources",
  builder_analyse_database: "Analyse database",
  builder_mapping: "Builder mapping",
} as const satisfies Readonly<Record<string, string>>;

/** The snake_case name of an MCP tool dms-ai serves. */
export type McpToolName = keyof typeof MCP_TOOL_TITLES;

/** Whether `name` is the name of an MCP tool dms-ai serves. */
export function isMcpToolName(name: string): name is McpToolName {
  return Object.hasOwn(MCP_TOOL_TITLES, name);
}
