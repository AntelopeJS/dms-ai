import type { ToolEntry } from "./types";

/** Prefix the agent SDK gives the module's own MCP tools. */
export const MCP_TOOL_PREFIX = "mcp__dms-ai__";

/** The agents' built-in tools, by the name they are logged under. */
const BUILTIN_TOOLS: Readonly<Record<string, ToolEntry>> = {
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
  UndoChangeSet: { icon: "i-ph-arrow-counter-clockwise", source: "assistant" },
  RedoChangeSet: { icon: "i-ph-arrow-clockwise", source: "assistant" },
};

/** The module's own MCP tools, by their bare name. */
const MODULE_TOOLS: Readonly<Record<string, ToolEntry>> = {
  GetCurrentPage: { icon: "i-ph-browser", source: "project" },
  NavigateToPage: { icon: "i-ph-arrow-square-out", source: "project" },
  FindPagesUsing: { icon: "i-ph-magnifying-glass", source: "project" },
  ListPages: { icon: "i-ph-list", source: "project" },
  AskUser: { icon: "i-ph-question", source: "assistant" },
  Typecheck: { icon: "i-ph-shield-check", source: "project" },
  QueryLogs: { icon: "i-ph-scroll", source: "project" },
  BuilderCatalog: { icon: "i-ph-books", source: "builder" },
  BuilderListPages: { icon: "i-ph-list", source: "builder" },
  BuilderPageStructure: { icon: "i-ph-tree-structure", source: "builder" },
  BuilderCreatePage: { icon: "i-ph-file-plus", source: "builder" },
  BuilderConfigurePage: { icon: "i-ph-sliders", source: "builder" },
  BuilderDeletePage: {
    icon: "i-ph-trash",
    source: "builder",
    isDestructive: true,
  },
  BuilderAddBlock: { icon: "i-ph-squares-four", source: "builder" },
  BuilderConfigureBlock: { icon: "i-ph-sliders", source: "builder" },
  BuilderMoveBlock: { icon: "i-ph-arrows-out-cardinal", source: "builder" },
  BuilderRemoveBlock: {
    icon: "i-ph-trash",
    source: "builder",
    isDestructive: true,
  },
  BuilderCreateCategory: { icon: "i-ph-folder-plus", source: "builder" },
  BuilderConfigureCategory: { icon: "i-ph-sliders", source: "builder" },
  BuilderDeleteCategory: {
    icon: "i-ph-trash",
    source: "builder",
    isDestructive: true,
  },
  BuilderRefresh: { icon: "i-ph-arrows-clockwise", source: "builder" },
  BuilderCreateResource: { icon: "i-ph-table", source: "builder" },
  BuilderDeleteResource: {
    icon: "i-ph-trash",
    source: "builder",
    isDestructive: true,
  },
  BuilderListResources: { icon: "i-ph-list", source: "builder" },
  BuilderResourceStructure: { icon: "i-ph-tree-structure", source: "builder" },
  BuilderAddField: { icon: "i-ph-plus-square", source: "builder" },
  BuilderConfigureField: { icon: "i-ph-sliders", source: "builder" },
  BuilderRemoveField: {
    icon: "i-ph-trash",
    source: "builder",
    isDestructive: true,
  },
  BuilderQueryTemplates: { icon: "i-ph-books", source: "builder" },
  BuilderAddQuery: { icon: "i-ph-database", source: "builder" },
  BuilderConfigureQuery: { icon: "i-ph-database", source: "builder" },
  BuilderRemoveQuery: {
    icon: "i-ph-trash",
    source: "builder",
    isDestructive: true,
  },
};

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
