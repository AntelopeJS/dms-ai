import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import type { ToolDecision } from "../../src/agent/provider.js";
import { buildSafeModeHooks } from "../../src/providers/claude/safe-mode.js";
import { TURN_SETTINGS } from "../helpers/turn-settings.js";

const ROOT = "/work/app";
const CALL_ID = "call-1";
const ASK = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
  },
};
const NO_DECISION = { continue: true };

interface HookRun {
  output: unknown;
  decisions: ToolDecision[];
}

async function preToolUse(
  command: string,
  permissionMode: string | undefined,
): Promise<HookRun> {
  const decisions: ToolDecision[] = [];
  const hooks = buildSafeModeHooks({
    getSettings: () => ({
      ...TURN_SETTINGS,
      mode: "auto",
      generationMode: "vibe",
    }),
    readRoots: [ROOT],
    hostProjectRoot: ROOT,
    onToolDecision: (decision) => decisions.push(decision),
  });
  const [matcher] = hooks.PreToolUse ?? [];
  const input: PreToolUseHookInput = {
    session_id: "session-1",
    transcript_path: "",
    cwd: ROOT,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: CALL_ID,
    tool_input: { command },
    permission_mode: permissionMode,
  };
  const output = await matcher.hooks[0](input, CALL_ID, {
    signal: new AbortController().signal,
  });
  return { output, decisions };
}

describe("the PreToolUse hook and the permission mode the CLI states", () => {
  it("asks about a dependency change when the CLI does not say its mode", async () => {
    const run = await preToolUse("pnpm add jsvat", undefined);
    expect(run.output).toEqual(ASK);
  });

  it("leaves a call outside Auto review to canUseTool, recording nothing", async () => {
    const run = await preToolUse("node -e 1", "default");
    expect(run.output).toEqual(NO_DECISION);
    expect(run.decisions).toEqual([]);
  });
});
