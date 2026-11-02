import { isAlwaysAsk } from "../../agent/permission-preview.js";
import { isAutoAllowedRead } from "../../agent/read-access.js";
import { isWebTool } from "../../agent/tool-kinds.js";
import type { ToolArgs } from "../../agent/edit-targets.js";
import { effectiveGenerationMode } from "../../builder/capability.js";
import {
  ASK_USER_QUESTION_BUILTIN_TOOL_NAME,
  FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES,
} from "../../constants/mcp.js";
import { READ_ONLY_TOOL_PATH_KEYS } from "../../constants/read-access.js";
import type { TurnSettings } from "../../state/settings-types.js";

/** One call the CLI is about to run. */
export interface GuardedCall {
  toolName: string;
  args: ToolArgs;
}

/** What the guard reads about the session the call runs in. */
export interface AutoGuardScope {
  /** Where read-only file tools run unasked. */
  readRoots: string[];
  hostProjectRoot: string;
  settings: TurnSettings;
}

type HostDecidedRule = (call: GuardedCall, scope: AutoGuardScope) => boolean;

/** The module's own MCP tools, auto-allowed by `canUseTool` without a prompt. */
export function isFirstPartyMcpTool(toolName: string): boolean {
  return FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES.has(toolName);
}

/**
 * They keep their `canUseTool` route: that is where the call ledger hears of
 * them and where they are recorded, and a Builder deletion reaches the prompt
 * of its own handler instead of being refused by the classifier first.
 */
const isFirstPartyCall: HostDecidedRule = (call) =>
  isFirstPartyMcpTool(call.toolName);

/**
 * The CLI asks `canUseTool` about the built-in question tool in every mode,
 * and `canUseTool` sends the agent to the AskUser tool: Auto review never
 * approves it, so it is never recorded as approved by Auto review.
 */
const isBuiltInQuestion: HostDecidedRule = (call) =>
  call.toolName === ASK_USER_QUESTION_BUILTIN_TOOL_NAME;

/** The always-ask set asks under Auto review as it does under Full auto. */
const isAlwaysAskCall: HostDecidedRule = (call, scope) =>
  isAlwaysAsk({
    ...call,
    alwaysAskDependencies: scope.settings.alwaysAskDependencies,
    alwaysAskBlockRemoval: scope.settings.alwaysAskBlockRemoval,
  });

/**
 * Auto review lets reads run without reviewing them, wherever they point, so
 * one outside the read roots asks, as it does in Ask first.
 */
const isUnreviewedRead: HostDecidedRule = (call, scope) =>
  READ_ONLY_TOOL_PATH_KEYS.has(call.toolName) &&
  !isAutoAllowedRead(
    call.toolName,
    call.args,
    scope.readRoots,
    scope.hostProjectRoot,
  );

/**
 * Safe scope keeps web access asking even under Full auto
 * (agent/effective-mode.ts), and Auto review is never looser than Full auto.
 */
const isSafeScopeWebCall: HostDecidedRule = (call, scope) =>
  isWebTool(call.toolName) &&
  effectiveGenerationMode(scope.settings.generationMode) === "safe";

const HOST_DECIDED_RULES: readonly HostDecidedRule[] = [
  isFirstPartyCall,
  isBuiltInQuestion,
  isAlwaysAskCall,
  isUnreviewedRead,
  isSafeScopeWebCall,
];

/**
 * Whether the sidecar, not Auto review, must decide a call while the CLI runs
 * in `auto`. Auto review approves a call without ever asking `canUseTool`, so
 * the PreToolUse hook hands these to it; everything else goes to the
 * classifier.
 */
export function isHostDecided(
  call: GuardedCall,
  scope: AutoGuardScope,
): boolean {
  return HOST_DECIDED_RULES.some((rule) => rule(call, scope));
}
