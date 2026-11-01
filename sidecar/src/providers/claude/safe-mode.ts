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
import { homedir } from "node:os";
import { z } from "zod";
import { isAbsolute, join, relative } from "node:path";
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

/**
 * Where plan mode writes its plan before ExitPlanMode reads it back for the plan card.
 */
const PLANS_DIRECTORY = join(homedir(), ".claude", "plans");

const fileToolCallSchema = z.object({
  tool_input: z.object({ file_path: z.string() }),
});

const preToolUseInputSchema = z.object({
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
});

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

export interface PreToolUseDeps {
  getGenerationMode: () => GenerationMode;
  /** A call safe mode refused, by the SDK's id for it. */
  onBlocked?: (callId: string, toolName: string) => void;
  /** Awaited before a mutating tool runs (the turn's checkpoint). */
  beforeMutation?: () => Promise<void>;
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
      preToolUseInputSchema.safeParse(input).data ?? {};
    if (deps.getGenerationMode() === "safe" && isBlockedTool(input)) {
      deps.onBlocked?.(callId, toolName);
      return SAFE_MODE_DENIAL;
    }
    if (isMutatingTool(toolName)) await deps.beforeMutation?.();
    return NO_DECISION;
  };
  return { [PRE_TOOL_USE_HOOK_EVENT]: [{ hooks: [preToolUse] }] };
}
