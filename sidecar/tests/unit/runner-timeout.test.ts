import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeRunner } from "../../src/agent/claude-runner.js";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { SDK_TIMEOUT_MESSAGE } from "../../src/constants/agent.js";

const SCRIPT_PATH = resolve(
  __dirname,
  "../fixtures/mock-claude/scripts/list-files.json",
);

const TIMEOUT_MS = 5;
const TEST_TIMEOUT_MS = 2_000;
// The mock streams 8 messages 50ms apart (~400ms total). An idle window wider
// than a single gap but narrower than the total separates idle-timeout from a
// wall-clock cap: the old hard cap aborted at 150ms, the idle timeout must not.
const IDLE_WINDOW_MS = 150;

describe("ClaudeRunner timeout via AbortController", () => {
  beforeEach(() => {
    process.env.MOCK_CLAUDE = "1";
    process.env.MOCK_CLAUDE_SCRIPT = SCRIPT_PATH;
  });

  afterEach(() => {
    delete process.env.MOCK_CLAUDE;
    delete process.env.MOCK_CLAUDE_SCRIPT;
  });

  it(
    "emits run_error with timeout message when SDK iteration exceeds the configured timeout",
    async () => {
      const runner = createClaudeRunner({ timeoutMs: TIMEOUT_MS });
      const events: RunnerEvent[] = [];
      for await (const event of runner.start("hang", {
        conversationId: "test-timeout",
        hostProjectRoot: "/tmp",
        getCurrentPage: () => ({ path: "unknown" }),
      })) {
        events.push(event);
      }
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      if (errorEvent !== undefined && errorEvent.type === "error") {
        expect(errorEvent.message).toBe(SDK_TIMEOUT_MESSAGE);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "does not time out a long turn that keeps emitting within the idle window",
    async () => {
      const runner = createClaudeRunner({ timeoutMs: IDLE_WINDOW_MS });
      const events: RunnerEvent[] = [];
      for await (const event of runner.start("list files", {
        conversationId: "test-idle",
        hostProjectRoot: "/tmp",
        getCurrentPage: () => ({ path: "unknown" }),
      })) {
        events.push(event);
      }
      // Ran ~400ms (longer than the idle window) yet finished cleanly,
      // because each gap stayed under the window and reset the deadline.
      expect(events.some((e) => e.type === "error")).toBe(false);
      expect(events.some((e) => e.type === "done")).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
