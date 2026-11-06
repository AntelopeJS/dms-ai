import type { ToolEntry } from "./types";

/** Prefix the agent SDK gives the module's own MCP tools. */
const MCP_TOOL_PREFIX = "mcp__dms-ai__";

/** The agents' built-in tools, by the name they are logged under. */
const BUILTIN_TOOLS = {
  Read: { icon: "i-ph-file-text", source: "code" },
  Write: { icon: "i-ph-file-plus", source: "code" },
  Edit: { icon: "i-ph-pencil-simple-line", source: "code" },
  MultiEdit: { icon: "i-ph-pencil-simple-line", source: "code" },
  NotebookEdit: { icon: "i-ph-notebook", source: "code" },
  Bash: { icon: "i-ph-terminal-window", source: "code" },
  Glob: { icon: "i-ph-files", source: "code" },
  Grep: { icon: "i-ph-magnifying-glass", source: "code" },
  LS: { icon: "i-ph-folder-open", source: "code" },
  WebFetch: { icon: "i-ph-globe", source: "web" },
  WebSearch: { icon: "i-ph-globe-hemisphere-west", source: "web" },
  TodoWrite: { icon: "i-ph-list-checks", source: "assistant" },
  Task: { icon: "i-ph-users-three", source: "assistant" },
  ExitPlanMode: { icon: "i-ph-list-checks", source: "assistant" },
  ToolSearch: { icon: "i-ph-wrench", source: "assistant" },
  Skill: { icon: "i-ph-books", source: "assistant" },
  AskUserQuestion: { icon: "i-ph-question", source: "assistant" },
  UndoChangeSet: { icon: "i-ph-arrow-counter-clockwise", source: "assistant" },
  RedoChangeSet: { icon: "i-ph-arrow-clockwise", source: "assistant" },
} satisfies Readonly<Record<string, ToolEntry>>;

/** The module's own MCP tools, by their bare name. */
const MODULE_TOOLS = {
  get_current_page: { icon: "i-ph-browser", source: "project" },
  navigate_to_page: { icon: "i-ph-arrow-square-out", source: "project" },
  find_pages_using: { icon: "i-ph-magnifying-glass", source: "project" },
  list_pages: { icon: "i-ph-list", source: "project" },
  ask_user: { icon: "i-ph-question", source: "assistant" },
  typecheck: { icon: "i-ph-shield-check", source: "project" },
  query_logs: { icon: "i-ph-scroll", source: "project" },
  builder_catalog: { icon: "i-ph-books", source: "builder" },
  builder_list_pages: { icon: "i-ph-list", source: "builder" },
  builder_page_structure: { icon: "i-ph-tree-structure", source: "builder" },
  builder_create_page: { icon: "i-ph-file-plus", source: "builder" },
  builder_configure_page: { icon: "i-ph-sliders", source: "builder" },
  builder_delete_page: {
    icon: "i-ph-trash",
    source: "builder",
    isDestructive: true,
  },
  builder_add_block: { icon: "i-ph-squares-four", source: "builder" },
  builder_compose_page: { icon: "i-ph-layout", source: "builder" },
  builder_configure_block: { icon: "i-ph-sliders", source: "builder" },
  builder_configure_table_view: { icon: "i-ph-table", source: "builder" },
  builder_move_block: { icon: "i-ph-arrows-out-cardinal", source: "builder" },
  builder_remove_block: {
    icon: "i-ph-trash",
    source: "builder",
    isDestructive: true,
  },
  builder_create_category: { icon: "i-ph-folder-plus", source: "builder" },
  builder_configure_category: { icon: "i-ph-sliders", source: "builder" },
  builder_delete_category: {
    icon: "i-ph-trash",
    source: "builder",
    isDestructive: true,
  },
  builder_refresh: { icon: "i-ph-arrows-clockwise", source: "builder" },
  builder_create_resource: { icon: "i-ph-table", source: "builder" },
  builder_delete_resource: {
    icon: "i-ph-trash",
    source: "builder",
    isDestructive: true,
  },
  builder_list_resources: { icon: "i-ph-list", source: "builder" },
  builder_resource_structure: {
    icon: "i-ph-tree-structure",
    source: "builder",
  },
  builder_add_field: { icon: "i-ph-plus-square", source: "builder" },
  builder_configure_field: { icon: "i-ph-sliders", source: "builder" },
  builder_remove_field: {
    icon: "i-ph-trash",
    source: "builder",
    isDestructive: true,
  },
  builder_query_templates: { icon: "i-ph-books", source: "builder" },
  builder_add_query: { icon: "i-ph-database", source: "builder" },
  builder_preview_query: { icon: "i-ph-eye", source: "builder" },
  builder_configure_query: { icon: "i-ph-database", source: "builder" },
  builder_remove_query: {
    icon: "i-ph-trash",
    source: "builder",
    isDestructive: true,
  },
} satisfies Readonly<Record<string, ToolEntry>>;

/** A tool as the activity log names it: by its bare name, which keys its label. */
export interface LoggedTool extends ToolEntry {
  name: string;
}

/** Every tool the log knows, in display order: the agents', then the module's. */
export const LOGGED_TOOLS: readonly LoggedTool[] = Object.entries({
  ...BUILTIN_TOOLS,
  ...MODULE_TOOLS,
}).map(([name, entry]) => ({ ...entry, name }));

const TOOLS_BY_NAME = new Map(LOGGED_TOOLS.map((tool) => [tool.name, tool]));

/** The bare name of a tool, the MCP prefix the agent SDK adds removed. */
export function bareToolName(value: string): string {
  return value.startsWith(MCP_TOOL_PREFIX)
    ? value.slice(MCP_TOOL_PREFIX.length)
    : value;
}

/** The known tool a logged name stands for, prefixed or not. */
export function findLoggedTool(value: string): LoggedTool | undefined {
  return TOOLS_BY_NAME.get(bareToolName(value));
}
