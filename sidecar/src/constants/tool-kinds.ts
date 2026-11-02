import type { BUILTIN_TOOL_NAMES } from "@anthropic-ai/claude-agent-sdk";
import { BUILDER_TOOL_NAMES } from "./builder.js";
import { DATABASE_TOOL_NAMES } from "./database.js";
import { QUERY_LOGS_TOOL_NAME } from "./logs.js";
import {
  ASK_USER_TOOL_NAME,
  GET_CURRENT_PAGE_TOOL_NAME,
  NAVIGATE_TOOL_NAME,
} from "./mcp.js";
import { FIND_PAGES_TOOL_NAME, LIST_PAGES_TOOL_NAME } from "./pages.js";
import { PREVIEW_BLOCKS_TOOL_NAME } from "./preview.js";
import { TYPECHECK_TOOL_NAME } from "./typecheck.js";

/**
 * What a built-in Claude Code tool can reach:
 *
 * - `readsPath`: reads the files at its path argument.
 * - `editsFile`: writes a file.
 * - `runsCommand`: runs a program now: a shell command, a watched command, a
 *   language server.
 * - `runsLater`: runs or schedules commands or agent turns beyond this turn, or
 *   on another machine.
 * - `fetchesWeb`: fetches a URL or searches the web.
 * - `startsAgent`: starts a sub-agent.
 * - `asksPerson`: the built-in question tool.
 * - `inert`: changes nothing outside the conversation: tool loading, the todo
 *   and task lists, skills, plan mode, the session's own agents and MCP
 *   resources.
 * - `reachesOutside`: acts outside the conversation another way: other Claude
 *   sessions, git worktrees, Anthropic or third-party services, a phone.
 */
export type ToolReach =
  | "readsPath"
  | "editsFile"
  | "runsCommand"
  | "runsLater"
  | "fetchesWeb"
  | "startsAgent"
  | "asksPerson"
  | "inert"
  | "reachesOutside";

type UnlistedToolName =
  | "Task"
  | "DesignSync"
  | "SendToProject"
  | "SendToProjectContext"
  | "MultiEdit"
  | "LS"
  | "NotebookRead";

export const BUILTIN_TOOL_REACH = {
  Read: "readsPath",
  Glob: "readsPath",
  Grep: "readsPath",
  LS: "readsPath",
  NotebookRead: "readsPath",
  Write: "editsFile",
  Edit: "editsFile",
  MultiEdit: "editsFile",
  NotebookEdit: "editsFile",
  Bash: "runsCommand",
  PowerShell: "runsCommand",
  Monitor: "runsCommand",
  LSP: "runsCommand",
  CronCreate: "runsLater",
  CronDelete: "runsLater",
  ScheduleWakeup: "runsLater",
  RemoteTrigger: "runsLater",
  Workflow: "runsLater",
  ProposeGoal: "runsLater",
  WebFetch: "fetchesWeb",
  WebSearch: "fetchesWeb",
  Agent: "startsAgent",
  Task: "startsAgent",
  AskUserQuestion: "asksPerson",
  ToolSearch: "inert",
  TodoWrite: "inert",
  TaskCreate: "inert",
  TaskGet: "inert",
  TaskUpdate: "inert",
  TaskList: "inert",
  TaskStop: "inert",
  Skill: "inert",
  EnterPlanMode: "inert",
  ExitPlanMode: "inert",
  ListAgents: "inert",
  CronList: "inert",
  SubagentHandback: "inert",
  ReportFindings: "inert",
  EndConversation: "inert",
  WaitForMcpServers: "inert",
  ListMcpResourcesTool: "inert",
  ReadMcpResourceTool: "inert",
  ReadMcpResourceDirTool: "inert",
  SendMessage: "reachesOutside",
  EnterWorktree: "reachesOutside",
  ExitWorktree: "reachesOutside",
  PushNotification: "reachesOutside",
  Artifact: "reachesOutside",
  ClaudeDesign: "reachesOutside",
  DesignSync: "reachesOutside",
  Projects: "reachesOutside",
  SendToProject: "reachesOutside",
  SendToProjectContext: "reachesOutside",
  SendFeedback: "reachesOutside",
  SendUserFile: "reachesOutside",
  SendUserMessage: "reachesOutside",
  ShareOnboardingGuide: "reachesOutside",
  ShowOnboardingRolePicker: "reachesOutside",
  OfferChromeSetup: "reachesOutside",
  ReadNotifications: "reachesOutside",
  propose_skills: "reachesOutside",
} as const satisfies Record<
  (typeof BUILTIN_TOOL_NAMES)[number] | UnlistedToolName,
  ToolReach
>;

function builtinToolsThat(reach: ToolReach): readonly string[] {
  return Object.entries(BUILTIN_TOOL_REACH).flatMap(([name, toolReach]) =>
    toolReach === reach ? [name] : [],
  );
}

/** Tools that write files the user can see in a diff. */
export const EDIT_TOOL_NAMES = builtinToolsThat("editsFile");

export const BASH_TOOL_NAMES: readonly string[] = ["Bash"];

export const WEB_TOOL_NAMES = builtinToolsThat("fetchesWeb");

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

type BuilderToolKind =
  | "read"
  | "change"
  | "deletion"
  | "blockRemoval"
  | "asksAfterDryRun";

const BUILDER_TOOL_KINDS = {
  BuilderCatalog: "read",
  BuilderListPages: "read",
  BuilderPageStructure: "read",
  BuilderCreatePage: "change",
  BuilderConfigurePage: "change",
  BuilderDeletePage: "deletion",
  BuilderAddBlock: "change",
  BuilderComposePage: "change",
  BuilderConfigureBlock: "change",
  BuilderConfigureTableView: "change",
  BuilderMoveBlock: "blockRemoval",
  BuilderRemoveBlock: "blockRemoval",
  BuilderCreateCategory: "change",
  BuilderConfigureCategory: "change",
  BuilderDeleteCategory: "deletion",
  BuilderRefresh: "read",
  BuilderCreateResource: "change",
  BuilderDeleteResource: "deletion",
  BuilderListResources: "read",
  BuilderResourceStructure: "read",
  BuilderAddField: "change",
  BuilderConfigureField: "change",
  BuilderRemoveField: "deletion",
  BuilderQueryTemplates: "read",
  BuilderAddQuery: "change",
  BuilderPreviewQuery: "read",
  BuilderConfigureQuery: "change",
  BuilderRemoveQuery: "deletion",
  BuilderConfigureProject: "asksAfterDryRun",
  BuilderMapResources: "change",
  BuilderAnalyseDatabase: "read",
  BuilderMapping: "read",
} as const satisfies Record<
  (typeof BUILDER_TOOL_NAMES)[number],
  BuilderToolKind
>;

function builderToolsOf(kind: BuilderToolKind): readonly string[] {
  return BUILDER_TOOL_NAMES.filter((name) => BUILDER_TOOL_KINDS[name] === kind);
}

export const BUILDER_READ_TOOL_NAMES = builderToolsOf("read");
export const BUILDER_DESTRUCTIVE_TOOL_NAMES = builderToolsOf("deletion");
export const BUILDER_BLOCK_REMOVAL_TOOL_NAMES = builderToolsOf("blockRemoval");
export const BUILDER_CONFIG_TOOL_NAMES = builderToolsOf("asksAfterDryRun");

export const BUILDER_DELETE_RESOURCE_TOOL_NAME = "BuilderDeleteResource";

/** The module's own tools that read or talk to the user, never mutate. */
export const PROJECT_READ_TOOL_NAMES: readonly string[] = [
  GET_CURRENT_PAGE_TOOL_NAME,
  NAVIGATE_TOOL_NAME,
  FIND_PAGES_TOOL_NAME,
  LIST_PAGES_TOOL_NAME,
  TYPECHECK_TOOL_NAME,
  QUERY_LOGS_TOOL_NAME,
  ...DATABASE_TOOL_NAMES,
];

export const ASSISTANT_TOOL_NAMES: readonly string[] = [
  ASK_USER_TOOL_NAME,
  PREVIEW_BLOCKS_TOOL_NAME,
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
