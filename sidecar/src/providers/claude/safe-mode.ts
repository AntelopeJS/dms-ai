import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import {
  CLAUDE_AUTO_PERMISSION_MODE,
  HOOK_ASK_DECISION,
  PRE_TOOL_USE_HOOK_EVENT,
} from "../../constants/claude.js";
import { SDK_PERMISSION_BEHAVIOR } from "../../constants/permissions.js";
import { SAFE_MODE_DENIED_MESSAGE } from "../../constants/settings.js";
import { z } from "zod";
import { ToolArgsSchema } from "../../agent/edit-targets.js";
import type { ToolCallHooks } from "../../agent/provider.js";
import { isMutatingTool, isWebTool } from "../../agent/tool-kinds.js";
import { effectiveGenerationMode } from "../../builder/capability.js";
import type { TurnSettings } from "../../state/settings-types.js";
import {
  type GuardedCall,
  type GuardScope,
  isHostDecided,
  runsInSafeScope,
} from "./tool-guard.js";

/** The hook callbacks a session hands the SDK, by event. */
export type SdkHooks = Partial<Record<HookEvent, HookCallbackMatcher[]>>;

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

const preToolUseInputSchema = z.object({
  tool_name: z.string().catch(""),
  tool_use_id: z.string().catch(""),
  tool_input: ToolArgsSchema,
  permission_mode: z.string().optional().catch(undefined),
});

type PreToolUseCall = z.infer<typeof preToolUseInputSchema>;

function isAutoReviewOrUnstated(call: PreToolUseCall): boolean {
  return (
    call.permission_mode === undefined ||
    call.permission_mode === CLAUDE_AUTO_PERMISSION_MODE
  );
}

export interface PreToolUseDeps
  extends
    Omit<GuardScope, "settings">,
    Pick<ToolCallHooks, "onToolDecision" | "beforeMutation"> {
  getSettings: () => TurnSettings;
}

function isAskedInAskFirst(toolName: string): boolean {
  return isMutatingTool(toolName) || isWebTool(toolName);
}

function decideByMode(
  deps: PreToolUseDeps,
  call: PreToolUseCall,
  guarded: GuardedCall,
  scope: GuardScope,
): SyncHookJSONOutput {
  if (isHostDecided(guarded, scope, call.permission_mode)) return HOST_DECISION;
  if (isAutoReviewOrUnstated(call) && isAskedInAskFirst(call.tool_name)) {
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
 * whatever the permission mode, which `canUseTool` does not. In every mode but
 * plan, it also sends to `canUseTool` each call the CLI would otherwise settle
 * without asking the person (see isHostDecided).
 */
export function buildSafeModeHooks(deps: PreToolUseDeps): SdkHooks {
  const preToolUse: HookCallback = async (input) => {
    const call = preToolUseInputSchema.parse(input);
    const scope: GuardScope = {
      readRoots: deps.readRoots,
      hostProjectRoot: deps.hostProjectRoot,
      settings: deps.getSettings(),
    };
    const guarded = { toolName: call.tool_name, args: call.tool_input };
    if (
      effectiveGenerationMode(scope.settings.generationMode) === "safe" &&
      !runsInSafeScope(guarded, scope)
    ) {
      deps.onToolDecision?.({
        callId: call.tool_use_id,
        toolName: call.tool_name,
        allowedBy: "blocked",
      });
      return SAFE_MODE_DENIAL;
    }
    if (isMutatingTool(call.tool_name)) await deps.beforeMutation?.();
    return decideByMode(deps, call, guarded, scope);
  };
  return { [PRE_TOOL_USE_HOOK_EVENT]: [{ hooks: [preToolUse] }] };
}
