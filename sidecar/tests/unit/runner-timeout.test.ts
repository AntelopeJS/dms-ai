import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { TURN_IDLE_TIMEOUT_MESSAGE } from "../../src/constants/agent.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { PROVIDER_FIXTURES } from "../helpers/provider-fixtures.js";
import { buildRunner, type RunnerHandle } from "../helpers/provider-runner.js";

const CONVERSATION_ID = "conv-timeout-1";
const TMP_PREFIX = "dms-ai-timeout-";
const IMMEDIATE_TIMEOUT_MS = 5;
// Wider than any single gap between two replayed events, narrower than a whole
// turn: it separates an idle timeout from a wall-clock cap.
const IDLE_WINDOW_MS = 2_000;
const TEST_TIMEOUT_MS = 30_000;

describe.each(PROVIDER_FIXTURES)("turn idle timeout on $name", (fixture) => {
  let dir: string;
  let handle: RunnerHandle | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    fixture.use("plain");
  });

  afterEach(async () => {
    await handle?.dispose();
    handle = undefined;
    fixture.reset();
    await rm(dir, { recursive: true, force: true });
  });

  async function collect(timeoutMs: number): Promise<RunnerEvent[]> {
    handle = buildRunner(fixture.name, {
      timeoutMs,
      stateDir: join(dir, ".state"),
    });
    const events: RunnerEvent[] = [];
    for await (const event of handle.runner.start("list", {
      conversationId: CONVERSATION_ID,
      hostProjectRoot: dir,
      getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
    })) {
      events.push(event);
    }
    return events;
  }

  it(
    "reports a timeout when the backend goes silent past the window",
    async () => {
      const events = await collect(IMMEDIATE_TIMEOUT_MS);
      const failure = events.find((e) => e.type === "error");
      expect(failure).toBeDefined();
      if (failure?.type !== "error") return;
      expect(failure.message).toBe(TURN_IDLE_TIMEOUT_MESSAGE);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "does not time out a long turn that keeps producing events",
    async () => {
      const events = await collect(IDLE_WINDOW_MS);
      expect(events.some((e) => e.type === "error")).toBe(false);
      expect(events.some((e) => e.type === "done")).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
