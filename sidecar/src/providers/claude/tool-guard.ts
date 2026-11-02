import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { readStringArg, type ToolArgs } from "../../agent/edit-targets.js";
import { isAlwaysAsk } from "../../agent/permission-preview.js";
import { isAutoAllowedRead } from "../../agent/read-access.js";
import { toolReachOf } from "../../agent/tool-kinds.js";
import { effectiveGenerationMode } from "../../builder/capability.js";
import { FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES } from "../../constants/mcp.js";
import type { ToolReach } from "../../constants/tool-kinds.js";
import type { TurnSettings } from "../../state/settings-types.js";

/** One call the CLI is about to run. */
export interface GuardedCall {
  toolName: string;
  args: ToolArgs;
}

/** What the guard reads about the session the call runs in. */
export interface GuardScope {
  /** Where read-only file tools run unasked. */
  readRoots: string[];
  hostProjectRoot: string;
  settings: TurnSettings;
}

type CallRule = (call: GuardedCall, scope: GuardScope) => boolean;

interface ReachPolicy {
  runsInSafeScope: CallRule;
  isLeftToClassifier: CallRule;
}

const PLANS_DIRECTORY = join(homedir(), ".claude", "plans");

const always: CallRule = () => true;
const never: CallRule = () => false;

const isPlanFile: CallRule = (call) => {
  const filePath = readStringArg(call.args, "file_path");
  if (filePath === undefined || !isAbsolute(filePath)) return false;
  const inside = relative(PLANS_DIRECTORY, filePath);
  return inside.length > 0 && !inside.startsWith("..") && !isAbsolute(inside);
};

const isReadInsideRoots: CallRule = (call, scope) =>
  isAutoAllowedRead(
    call.toolName,
    call.args,
    scope.readRoots,
    scope.hostProjectRoot,
  );

const isNotAlwaysAsk: CallRule = (call, scope) =>
  !isAlwaysAsk({
    ...call,
    hostProjectRoot: scope.hostProjectRoot,
    alwaysAskDependencies: scope.settings.alwaysAskDependencies,
    alwaysAskBlockRemoval: scope.settings.alwaysAskBlockRemoval,
    isAutoReview: true,
  });

const isCodeScope: CallRule = (_call, scope) =>
  effectiveGenerationMode(scope.settings.generationMode) === "vibe";

const runsInThisSession: CallRule = (call) => call.args.isolation === undefined;

const POLICY_BY_REACH: Record<ToolReach, ReachPolicy> = {
  readsPath: { runsInSafeScope: always, isLeftToClassifier: isReadInsideRoots },
  editsFile: {
    runsInSafeScope: isPlanFile,
    isLeftToClassifier: isNotAlwaysAsk,
  },
  runsCommand: { runsInSafeScope: never, isLeftToClassifier: never },
  runsLater: { runsInSafeScope: never, isLeftToClassifier: never },
  fetchesWeb: { runsInSafeScope: always, isLeftToClassifier: isCodeScope },
  startsAgent: {
    runsInSafeScope: runsInThisSession,
    isLeftToClassifier: runsInThisSession,
  },
  asksPerson: { runsInSafeScope: always, isLeftToClassifier: never },
  inert: { runsInSafeScope: always, isLeftToClassifier: always },
  reachesOutside: { runsInSafeScope: never, isLeftToClassifier: never },
};

/** The module's own MCP tools, auto-allowed by `canUseTool` without a prompt. */
export function isFirstPartyMcpTool(toolName: string): boolean {
  return FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES.has(toolName);
}

/**
 * Whether Safe scope lets a call run: the module's own tools, and the built-in
 * tools whose reach it allows. Any other name is refused, a tool the CLI adds
 * included.
 */
export function runsInSafeScope(call: GuardedCall, scope: GuardScope): boolean {
  if (isFirstPartyMcpTool(call.toolName)) return true;
  const reach = toolReachOf(call.toolName);
  if (reach === undefined) return false;
  return POLICY_BY_REACH[reach].runsInSafeScope(call, scope);
}

/**
 * Whether the sidecar, not Auto review, must decide a call while the CLI runs
 * in `auto`. Auto review approves a call without ever asking `canUseTool`, so
 * the PreToolUse hook hands these to it. Any name the table does not classify
 * is one, a tool the CLI adds included.
 */
export function isHostDecided(call: GuardedCall, scope: GuardScope): boolean {
  if (isFirstPartyMcpTool(call.toolName)) return true;
  const reach = toolReachOf(call.toolName);
  if (reach === undefined) return true;
  return !POLICY_BY_REACH[reach].isLeftToClassifier(call, scope);
}
