import { BUILDER_TOOL_NAMES } from "./builder.js";
import { QUERY_LOGS_TOOL_NAME } from "./logs.js";
import {
  ASK_USER_TOOL_NAME,
  GET_CURRENT_PAGE_TOOL_NAME,
  NAVIGATE_TOOL_NAME,
} from "./mcp.js";
import { FIND_PAGES_TOOL_NAME, LIST_PAGES_TOOL_NAME } from "./pages.js";
import { TYPECHECK_TOOL_NAME } from "./typecheck.js";

/** Tools that write files the user can see in a diff. */
export const EDIT_TOOL_NAMES: readonly string[] = [
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
];

export const COMMAND_TOOL_NAMES: readonly string[] = ["Bash"];

export const WEB_TOOL_NAMES: readonly string[] = ["WebFetch", "WebSearch"];

/** Built-in tools that never mutate anything. */
export const BUILTIN_READ_TOOL_NAMES: readonly string[] = [
  "Read",
  "LS",
  "Glob",
  "Grep",
  "NotebookRead",
  "TodoWrite",
  "Skill",
  "Task",
  "ExitPlanMode",
];

/** Builder tools that only read the Builder's model of the project. */
export const BUILDER_READ_TOOL_NAMES: readonly string[] = [
  "BuilderCatalog",
  "BuilderListPages",
  "BuilderPageStructure",
  "BuilderListResources",
  "BuilderResourceStructure",
  "BuilderQueryTemplates",
  "BuilderRefresh",
];

/** Builder deletions: they always ask, in every mode, Full auto included. */
export const BUILDER_DESTRUCTIVE_TOOL_NAMES: readonly string[] = [
  "BuilderDeletePage",
  "BuilderDeleteResource",
  "BuilderRemoveField",
  "BuilderDeleteCategory",
  "BuilderRemoveQuery",
];

/** Asked whenever the `alwaysAskBlockRemoval` setting is on. */
export const BUILDER_BLOCK_REMOVAL_TOOL_NAMES: readonly string[] = [
  "BuilderRemoveBlock",
  "BuilderMoveBlock",
];

export const BUILDER_DELETE_RESOURCE_TOOL_NAME = "BuilderDeleteResource";

/** The module's own tools that read or talk to the user, never mutate. */
export const PROJECT_READ_TOOL_NAMES: readonly string[] = [
  GET_CURRENT_PAGE_TOOL_NAME,
  NAVIGATE_TOOL_NAME,
  FIND_PAGES_TOOL_NAME,
  LIST_PAGES_TOOL_NAME,
  TYPECHECK_TOOL_NAME,
  QUERY_LOGS_TOOL_NAME,
];

export const ASSISTANT_TOOL_NAMES: readonly string[] = [
  ASK_USER_TOOL_NAME,
  "TodoWrite",
  "Skill",
  "Task",
  "ExitPlanMode",
];

export const BUILDER_MUTATING_TOOL_NAMES: readonly string[] =
  BUILDER_TOOL_NAMES.filter((name) => !BUILDER_READ_TOOL_NAMES.includes(name));

export const SKILL_TOOL_NAME = "Skill";
export const SKILL_TOOL_ARG_KEYS: readonly string[] = ["skill", "command"];
export const SKILL_FILE_NAME = "SKILL.md";
