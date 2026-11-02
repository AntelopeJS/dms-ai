import type {
  HookCallback,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { reachesSecretFile } from "../../agent/project-secrets.js";
import { PRE_TOOL_USE_HOOK_EVENT } from "../../constants/claude.js";
import { SDK_PERMISSION_BEHAVIOR } from "../../constants/permissions.js";
import { SECRET_FILE_DENIED_MESSAGE } from "../../constants/project-secrets.js";
import type { SdkHooks } from "./safe-mode.js";

const SECRET_FILE_DENIAL: SyncHookJSONOutput = {
  hookSpecificOutput: {
    hookEventName: PRE_TOOL_USE_HOOK_EVENT,
    permissionDecision: SDK_PERMISSION_BEHAVIOR.DENY,
    permissionDecisionReason: SECRET_FILE_DENIED_MESSAGE,
  },
};

const NO_DECISION: SyncHookJSONOutput = { continue: true };

const optionalString = z.string().optional().catch(undefined);

const toolCallSchema = z.object({
  cwd: optionalString,
  tool_input: z
    .looseObject({
      file_path: optionalString,
      path: optionalString,
      notebook_path: optionalString,
    })
    .default({}),
});

type ToolCall = z.infer<typeof toolCallSchema>;

async function reachesSecret({ cwd, tool_input }: ToolCall): Promise<boolean> {
  const paths = [
    tool_input.file_path,
    tool_input.path,
    tool_input.notebook_path,
  ];
  const checks = paths.map(
    async (path) =>
      path !== undefined &&
      (await reachesSecretFile(path, cwd ?? process.cwd())),
  );
  return (await Promise.all(checks)).some(Boolean);
}

/**
 * Adds a `PreToolUse` hook that refuses any tool call naming a secret file, or a link that resolves to one.
 * The CLI runs hooks before its own permission mode, so the refusal holds
 * where a plain read under the project would be allowed unasked, and a hook
 * denial is final.
 */
export function withSecretFileGuard(hooks: SdkHooks): SdkHooks {
  const guard: HookCallback = async (input) => {
    const parsed = toolCallSchema.safeParse(input);
    return parsed.success && (await reachesSecret(parsed.data))
      ? SECRET_FILE_DENIAL
      : NO_DECISION;
  };
  return {
    ...hooks,
    [PRE_TOOL_USE_HOOK_EVENT]: [
      ...(hooks[PRE_TOOL_USE_HOOK_EVENT] ?? []),
      { hooks: [guard] },
    ],
  };
}
