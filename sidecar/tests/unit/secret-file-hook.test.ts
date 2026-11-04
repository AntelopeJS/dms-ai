import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRE_TOOL_USE_HOOK_EVENT } from "../../src/constants/claude.js";
import { SDK_PERMISSION_BEHAVIOR } from "../../src/constants/permissions.js";
import { SECRET_FILE_DENIED_MESSAGE } from "../../src/constants/project-secrets.js";
import { withSecretFileGuard } from "../../src/providers/claude/secret-files.js";

describe("the secret file hook on links", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-secret-hook-"));
    await writeFile(join(dir, ".env"), "TOKEN=canary\n");
    await writeFile(join(dir, ".env.example"), "TOKEN=\n");
    await symlink(".env", join(dir, "config.txt"));
    await symlink(".env.example", join(dir, "template.txt"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function decide(toolName: string, toolInput: Record<string, string>) {
    const matchers = withSecretFileGuard({})[PRE_TOOL_USE_HOOK_EVENT] ?? [];
    const input: HookInput = {
      hook_event_name: PRE_TOOL_USE_HOOK_EVENT,
      session_id: "session",
      transcript_path: join(dir, "transcript.jsonl"),
      tool_use_id: "toolu_1",
      tool_name: toolName,
      tool_input: toolInput,
      cwd: dir,
    };
    const [guard] = matchers.flatMap((matcher) => matcher.hooks);
    return guard?.(input, undefined, { signal: new AbortController().signal });
  }

  it.each(["file_path", "path", "notebook_path"])(
    "refuses a link to .env named by %s, with the refusal message",
    async (key) => {
      expect(await decide("Read", { [key]: "config.txt" })).toEqual({
        hookSpecificOutput: {
          hookEventName: PRE_TOOL_USE_HOOK_EVENT,
          permissionDecision: SDK_PERMISSION_BEHAVIOR.DENY,
          permissionDecisionReason: SECRET_FILE_DENIED_MESSAGE,
        },
      });
    },
  );

  it("lets a link to .env.example through", async () => {
    expect(await decide("Read", { file_path: "template.txt" })).toEqual({
      continue: true,
    });
  });

  it("still refuses a Write to .env.local, which does not exist", async () => {
    const decision = await decide("Write", { file_path: ".env.local" });
    expect(decision).toMatchObject({
      hookSpecificOutput: { permissionDecision: SDK_PERMISSION_BEHAVIOR.DENY },
    });
  });
});
