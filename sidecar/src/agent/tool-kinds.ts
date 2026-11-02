import { z } from "zod";
import type { PermissionKind, ToolSource } from "../constants/audit.js";
import {
  BUILDER_TOOL_NAMES,
  PAGES_TO_REMOVE_ARG,
} from "../constants/builder.js";
import { MCP_TOOL_NAME_PREFIX } from "../constants/mcp.js";
import {
  ASSISTANT_TOOL_NAMES,
  BUILDER_BLOCK_REMOVAL_TOOL_NAMES,
  BUILDER_CONFIG_TOOL_NAMES,
  BUILDER_DESTRUCTIVE_TOOL_NAMES,
  BUILDER_MUTATING_TOOL_NAMES,
  BUILDER_PAGE_REMOVING_TOOL_NAMES,
  BUILDER_READ_TOOL_NAMES,
  BUILTIN_READ_TOOL_NAMES,
  BUILTIN_TOOL_REACH,
  BASH_TOOL_NAMES,
  EDIT_TOOL_NAMES,
  PROJECT_READ_TOOL_NAMES,
  type ToolReach,
  WEB_TOOL_NAMES,
} from "../constants/tool-kinds.js";
import type { ToolArgs } from "./edit-targets.js";

const REACH_BY_BUILTIN_TOOL: ReadonlyMap<string, ToolReach> = new Map(
  Object.entries(BUILTIN_TOOL_REACH),
);

/**
 * What a built-in tool reaches, by the exact name the CLI hands the hook;
 * undefined for any other name, MCP tools included.
 */
export function toolReachOf(toolName: string): ToolReach | undefined {
  return REACH_BY_BUILTIN_TOOL.get(toolName);
}

/** The tool's own name, without the `mcp__dms-ai__` prefix the agent sees. */
export function bareToolName(toolName: string): string {
  return toolName.startsWith(MCP_TOOL_NAME_PREFIX)
    ? toolName.slice(MCP_TOOL_NAME_PREFIX.length)
    : toolName;
}

function isIn(names: readonly string[]): (toolName: string) => boolean {
  return (toolName) => names.includes(bareToolName(toolName));
}

export const isEditTool = isIn(EDIT_TOOL_NAMES);
export const isBashTool = isIn(BASH_TOOL_NAMES);
export const isWebTool = isIn(WEB_TOOL_NAMES);
const isBuilderTool = isIn(BUILDER_TOOL_NAMES);
export const isDestructiveBuilderTool = isIn(BUILDER_DESTRUCTIVE_TOOL_NAMES);
export const isBlockRemovalTool = isIn(BUILDER_BLOCK_REMOVAL_TOOL_NAMES);
export const isMutatingBuilderTool = isIn(BUILDER_MUTATING_TOOL_NAMES);
export const isConfigBuilderTool = isIn(BUILDER_CONFIG_TOOL_NAMES);
export const isPageRemovingBuilderTool = isIn(BUILDER_PAGE_REMOVING_TOOL_NAMES);

const PagesToRemoveArgsSchema = z.object({
  [PAGES_TO_REMOVE_ARG]: z.array(z.string()),
});

/** The pages a mapping's preview found it would remove, as the handler hands them to the gate. */
export function pagesToRemoveOf(args: ToolArgs): string[] {
  return PagesToRemoveArgsSchema.safeParse(args).data?.pagesToRemove ?? [];
}

/**
 * Whether a Builder call waits for the person whatever the mode: deletions, project
 * configuration, and a mapping whose preview found a page to remove.
 */
export function asksBeforeBuilderCall(
  toolName: string,
  args: ToolArgs,
): boolean {
  if (isDestructiveBuilderTool(toolName)) return true;
  if (isConfigBuilderTool(toolName)) return true;
  return (
    isPageRemovingBuilderTool(toolName) && pagesToRemoveOf(args).length > 0
  );
}

const READ_ONLY_TOOL_NAMES: readonly string[] = [
  ...BUILTIN_READ_TOOL_NAMES,
  ...BUILDER_READ_TOOL_NAMES,
  ...PROJECT_READ_TOOL_NAMES,
  ...ASSISTANT_TOOL_NAMES,
];

/** Tools that never change anything, so they never need an approval. */
export const isReadOnlyTool = isIn(READ_ONLY_TOOL_NAMES);

/** Tools that may change files: edits, commands and Builder operations. */
export function isMutatingTool(toolName: string): boolean {
  return (
    isEditTool(toolName) ||
    isBashTool(toolName) ||
    isMutatingBuilderTool(toolName)
  );
}

interface KindMatcher {
  kind: PermissionKind;
  matches: (toolName: string) => boolean;
}

/** First match wins: destructive Builder ops before the other Builder ones. */
const KIND_MATCHERS: readonly KindMatcher[] = [
  { kind: "edit", matches: isEditTool },
  { kind: "command", matches: isBashTool },
  { kind: "web", matches: isWebTool },
  { kind: "destructive", matches: isDestructiveBuilderTool },
  { kind: "builder", matches: isBuilderTool },
];

export function permissionKindOf(toolName: string): PermissionKind {
  return KIND_MATCHERS.find((m) => m.matches(toolName))?.kind ?? "other";
}

interface SourceMatcher {
  source: ToolSource;
  matches: (toolName: string) => boolean;
}

const SOURCE_MATCHERS: readonly SourceMatcher[] = [
  { source: "builder", matches: isBuilderTool },
  { source: "project", matches: isIn(PROJECT_READ_TOOL_NAMES) },
  { source: "web", matches: isWebTool },
  { source: "assistant", matches: isIn(ASSISTANT_TOOL_NAMES) },
];

/** Where a tool comes from, for the Overview's top tools. */
export function toolSourceOf(toolName: string): ToolSource {
  return SOURCE_MATCHERS.find((m) => m.matches(toolName))?.source ?? "code";
}
