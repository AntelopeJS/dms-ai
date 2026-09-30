import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { PRE_TOOL_USE_HOOK_EVENT } from "../../constants/claude.js";
import { SDK_PERMISSION_BEHAVIOR } from "../../constants/permissions.js";
import {
  SAFE_MODE_DENIED_MESSAGE,
  SAFE_MODE_DISALLOWED_TOOLS,
} from "../../constants/settings.js";
import type { GenerationMode } from "../../state/settings-types.js";

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

const NO_DECISION: SyncHookJSONOutput = { continue: true };

function isBlockedTool(input: HookInput): boolean {
  if (input.hook_event_name !== PRE_TOOL_USE_HOOK_EVENT) return false;
  return SAFE_MODE_BLOCKED_TOOLS.has(input.tool_name);
}

/**
 * Enforces safe mode as a `PreToolUse` hook. The CLI runs hooks before it
 * applies the permission mode, and a hook denial is final, so the refusal holds
 * in `acceptEdits`, `plan` and `bypassPermissions`, where `canUseTool` is never
 * asked about an edit. The generation mode is read on every call: a safe/vibe
 * flip applies to the next tool call without a new session.
 */
export function buildSafeModeHooks(
  getGenerationMode: () => GenerationMode,
): SdkHooks {
  const refuseRawEdits: HookCallback = async (input) =>
    getGenerationMode() === "safe" && isBlockedTool(input)
      ? SAFE_MODE_DENIAL
      : NO_DECISION;
  return { [PRE_TOOL_USE_HOOK_EVENT]: [{ hooks: [refuseRawEdits] }] };
}
