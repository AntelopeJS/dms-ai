import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import {
  CLAUDE_AUTO_PERMISSION_MODE,
  HOOK_ASK_DECISION,
  PRE_TOOL_USE_HOOK_EVENT,
} from "../../constants/claude.js";
import { SDK_PERMISSION_BEHAVIOR } from "../../constants/permissions.js";
import {
  SAFE_MODE_DENIED_MESSAGE,
  SAFE_MODE_DISALLOWED_TOOLS,
} from "../../constants/settings.js";
import { homedir } from "node:os";
import { z } from "zod";
import { isAbsolute, join, relative } from "node:path";
import { ToolArgsSchema } from "../../agent/edit-targets.js";
import type { ToolCallHooks } from "../../agent/provider.js";
import { isMutatingTool, isWebTool } from "../../agent/tool-kinds.js";
import { effectiveGenerationMode } from "../../builder/capability.js";
import type { TurnSettings } from "../../state/settings-types.js";
import { type AutoGuardScope, isHostDecided } from "./auto-guard.js";

/** The hook callbacks a session hands the SDK, by event. */
export type SdkHooks = Partial<Record<HookEvent, HookCallbackMatcher[]>>;

const SAFE_MODE_BLOCKED_TOOLS = new Set(SAFE_MODE_DISALLOWED_TOOLS);

const SAFE_MODE_DENIAL: SyncHookJSONOutput = {
  hookSpecificOutput: {
    hookEventName: PRE_TOOL_USE_HOOK_EVENT,
    permissionDecision: SDK_PERMISSION_BEHAVIOR.DENY,
    permissionDecisionReason: SAFE_MODE_DENIED_MESSAGE,
  },
};

const HOST_DECISION: SyncHookJSONOutput = {
  hookSpecificOutput: {
    hookEventName: PRE_TOOL_USE_HOOK_EVENT,
    permissionDecision: HOOK_ASK_DECISION,
  },
};

const NO_DECISION: SyncHookJSONOutput = { continue: true };

/**
 * Where plan mode writes its plan before ExitPlanMode reads it back for the plan card.
 */
const PLANS_DIRECTORY = join(homedir(), ".claude", "plans");

const fileToolCallSchema = z.object({
  tool_input: z.object({ file_path: z.string() }),
});

const preToolUseInputSchema = z.object({
  tool_name: z.string().catch(""),
  tool_use_id: z.string().catch(""),
  tool_input: ToolArgsSchema,
  permission_mode: z.string().optional().catch(undefined),
});

type PreToolUseCall = z.infer<typeof preToolUseInputSchema>;

/** Plan mode's own plan file, which safe mode lets through: it is not a project file. */
function isPlanFile(input: HookInput): boolean {
  const call = fileToolCallSchema.safeParse(input);
  if (!call.success) return false;
  const filePath = call.data.tool_input.file_path;
  if (!isAbsolute(filePath)) return false;
  const inside = relative(PLANS_DIRECTORY, filePath);
  return inside.length > 0 && !inside.startsWith("..") && !isAbsolute(inside);
}

function isBlockedTool(input: HookInput): boolean {
  if (input.hook_event_name !== PRE_TOOL_USE_HOOK_EVENT) return false;
  return SAFE_MODE_BLOCKED_TOOLS.has(input.tool_name) && !isPlanFile(input);
}

function isAutoReviewOrUnstated(call: PreToolUseCall): boolean {
  return (
    call.permission_mode === undefined ||
    call.permission_mode === CLAUDE_AUTO_PERMISSION_MODE
  );
}

export interface PreToolUseDeps
  extends
    Omit<AutoGuardScope, "settings">,
    Pick<ToolCallHooks, "onToolDecision" | "beforeMutation"> {
  getSettings: () => TurnSettings;
}

function isAskedInAskFirst(toolName: string): boolean {
  return isMutatingTool(toolName) || isWebTool(toolName);
}

function decideUnderAutoReview(
  deps: PreToolUseDeps,
  call: PreToolUseCall,
): SyncHookJSONOutput {
  const scope: AutoGuardScope = {
    readRoots: deps.readRoots,
    hostProjectRoot: deps.hostProjectRoot,
    settings: deps.getSettings(),
  };
  const guarded = { toolName: call.tool_name, args: call.tool_input };
  if (isHostDecided(guarded, scope)) return HOST_DECISION;
  if (isAskedInAskFirst(call.tool_name)) {
    deps.onToolDecision?.({
      callId: call.tool_use_id,
      toolName: call.tool_name,
      allowedBy: "auto_approved",
    });
  }
  return NO_DECISION;
}

/**
 * Enforces safe mode as a `PreToolUse` hook. The CLI runs hooks before it
 * applies the permission mode, and a hook denial is final, so the refusal holds
 * in `acceptEdits`, `plan` and `auto`, where `canUseTool` is never asked about
 * an edit. The generation mode is read on every call: a safe/vibe flip applies
 * to the next tool call without a new session. The same hook holds every
 * mutating tool until the turn's checkpoint is taken: it runs before the tool
 * whatever the permission mode, which `canUseTool` does not.
 */
export function buildSafeModeHooks(deps: PreToolUseDeps): SdkHooks {
  const preToolUse: HookCallback = async (input) => {
    const call = preToolUseInputSchema.parse(input);
    const generationMode = deps.getSettings().generationMode;
    if (
      effectiveGenerationMode(generationMode) === "safe" &&
      isBlockedTool(input)
    ) {
      deps.onToolDecision?.({
        callId: call.tool_use_id,
        toolName: call.tool_name,
        allowedBy: "blocked",
      });
      return SAFE_MODE_DENIAL;
    }
    if (isMutatingTool(call.tool_name)) await deps.beforeMutation?.();
    if (!isAutoReviewOrUnstated(call)) return NO_DECISION;
    return decideUnderAutoReview(deps, call);
  };
  return { [PRE_TOOL_USE_HOOK_EVENT]: [{ hooks: [preToolUse] }] };
}
