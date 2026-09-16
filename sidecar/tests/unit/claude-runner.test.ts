import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeRunner } from "../../src/agent/claude-runner.js";
import type { RunnerEvent } from "../../src/agent/runner-events.js";

const SCRIPT_PATH = resolve(
  __dirname,
  "../fixtures/mock-claude/scripts/list-files.json",
);

const EXPECTED_PREFIX: readonly RunnerEvent["type"][] = [
  "assistant_text_delta",
  "assistant_text",
  "tool_use",
  "tool_result",
  "assistant_text_delta",
  "assistant_text",
  "done",
];

describe("ClaudeRunner with mock SDK", () => {
  beforeEach(() => {
    process.env.MOCK_CLAUDE = "1";
    process.env.MOCK_CLAUDE_SCRIPT = SCRIPT_PATH;
  });

  afterEach(() => {
    delete process.env.MOCK_CLAUDE;
    delete process.env.MOCK_CLAUDE_SCRIPT;
  });

  it("adapts the mock SDK stream into the expected RunnerEvent sequence", async () => {
    const runner = createClaudeRunner();
    const events: RunnerEvent[] = [];
    for await (const event of runner.start("list", {
      conversationId: "test",
      hostProjectRoot: "/tmp",
      getCurrentPage: () => ({ path: "unknown" }),
    })) {
      events.push(event);
    }
    const types = events.map((e) => e.type);
    expect(types).toEqual(EXPECTED_PREFIX);
    const toolUse = events.find((e) => e.type === "tool_use");
    expect(toolUse).toBeDefined();
    if (toolUse !== undefined && toolUse.type === "tool_use") {
      expect(toolUse.toolName).toBe("Glob");
      expect(toolUse.callId).toBe("toolu_mock_glob_1");
    }
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toBeDefined();
    if (toolResult !== undefined && toolResult.type === "tool_result") {
      expect(toolResult.callId).toBe("toolu_mock_glob_1");
      expect(toolResult.isError).toBe(false);
    }
  });
});
