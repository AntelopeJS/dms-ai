import type { PermissionKind, ToolSource } from "../constants/audit.js";
import { BUILDER_TOOL_NAMES } from "../constants/builder.js";
import { MCP_TOOL_NAME_PREFIX } from "../constants/mcp.js";
import {
  ASSISTANT_TOOL_NAMES,
  BUILDER_BLOCK_REMOVAL_TOOL_NAMES,
  BUILDER_DESTRUCTIVE_TOOL_NAMES,
  BUILDER_MUTATING_TOOL_NAMES,
  BUILDER_READ_TOOL_NAMES,
  BUILTIN_READ_TOOL_NAMES,
  COMMAND_TOOL_NAMES,
  EDIT_TOOL_NAMES,
  PROJECT_READ_TOOL_NAMES,
  WEB_TOOL_NAMES,
} from "../constants/tool-kinds.js";

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
export const isCommandTool = isIn(COMMAND_TOOL_NAMES);
export const isWebTool = isIn(WEB_TOOL_NAMES);
export const isBuilderTool = isIn(BUILDER_TOOL_NAMES);
export const isDestructiveBuilderTool = isIn(BUILDER_DESTRUCTIVE_TOOL_NAMES);
export const isBlockRemovalTool = isIn(BUILDER_BLOCK_REMOVAL_TOOL_NAMES);
export const isMutatingBuilderTool = isIn(BUILDER_MUTATING_TOOL_NAMES);

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
    isCommandTool(toolName) ||
    isMutatingBuilderTool(toolName)
  );
}

interface KindMatcher {
  kind: PermissionKind;
  matches: (toolName: string) => boolean;
}

// First match wins: destructive Builder ops before the other Builder ones.
const KIND_MATCHERS: readonly KindMatcher[] = [
  { kind: "edit", matches: isEditTool },
  { kind: "command", matches: isCommandTool },
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
