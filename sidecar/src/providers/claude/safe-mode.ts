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
import { isMutatingTool } from "../../agent/tool-kinds.js";
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

export interface PreToolUseDeps {
  getGenerationMode: () => GenerationMode;
  /** A call safe mode refused, by the SDK's id for it. */
  onBlocked?: (callId: string, toolName: string) => void;
  /** Awaited before a mutating tool runs (the turn's checkpoint). */
  beforeMutation?: () => Promise<void>;
}

interface PreToolUseInput {
  tool_name?: string;
  tool_use_id?: string;
}

/**
 * Enforces safe mode as a `PreToolUse` hook. The CLI runs hooks before it
 * applies the permission mode, and a hook denial is final, so the refusal holds
 * in `acceptEdits` and `plan`, where `canUseTool` is never asked about an edit.
 * The generation mode is read on every call: a safe/vibe flip applies to the
 * next tool call without a new session. The same hook holds every mutating
 * tool until the turn's checkpoint is taken: it runs before the tool whatever
 * the permission mode, which `canUseTool` does not.
 */
export function buildSafeModeHooks(deps: PreToolUseDeps): SdkHooks {
  const preToolUse: HookCallback = async (input) => {
    const { tool_name: toolName = "", tool_use_id: callId = "" } =
      input as PreToolUseInput;
    if (deps.getGenerationMode() === "safe" && isBlockedTool(input)) {
      deps.onBlocked?.(callId, toolName);
      return SAFE_MODE_DENIAL;
    }
    if (isMutatingTool(toolName)) await deps.beforeMutation?.();
    return NO_DECISION;
  };
  return { [PRE_TOOL_USE_HOOK_EVENT]: [{ hooks: [preToolUse] }] };
}
