import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toolReachOf } from "../../src/agent/tool-kinds.js";
import { resolveClaudeBinary } from "../../src/providers/claude/resolve-binary.js";

const INIT_TIMEOUT_MS = 30_000;

async function announcedTools(home: string): Promise<string[]> {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  async function* prompt(): AsyncIterable<SDKUserMessage> {
    yield {
      type: "user",
      message: { role: "user", content: "hi" },
      parent_tool_use_id: null,
      session_id: "",
    };
    await held;
  }
  const session = query({
    prompt: prompt(),
    options: {
      cwd: home,
      settingSources: [],
      permissionMode: "auto",
      pathToClaudeCodeExecutable: resolveClaudeBinary(),
      canUseTool: () =>
        Promise.resolve({ behavior: "deny", message: "coverage check" }),
      env: { PATH: process.env.PATH, HOME: home },
    },
  });
  try {
    for await (const message of session) {
      if (message.type === "system" && message.subtype === "init") {
        return message.tools;
      }
    }
    return [];
  } finally {
    release();
    session.close();
  }
}

describe("the tool classification against the installed Claude Code CLI", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dms-ai-tool-coverage-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it(
    "classifies every built-in tool the CLI announces",
    async () => {
      const tools = await announcedTools(home);
      expect(tools).toContain("Bash");
      expect(
        tools.filter(
          (name) =>
            !name.startsWith("mcp__") && toolReachOf(name) === undefined,
        ),
      ).toEqual([]);
    },
    INIT_TIMEOUT_MS,
  );
});
