import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { PROVIDER_FIXTURES } from "../helpers/provider-fixtures.js";
import { buildRunner, type RunnerHandle } from "../helpers/provider-runner.js";

const CONVERSATION_ID = "conv-stream-1";
const TMP_PREFIX = "dms-ai-stream-";
const TEST_TIMEOUT_MS = 30_000;

// The neutral vocabulary both adapters are meant to produce: text streams in as
// deltas, a tool call is opened and closed, and the turn ends on `done`.
describe.each(PROVIDER_FIXTURES)("runner event stream on $name", (fixture) => {
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

  async function collect(): Promise<RunnerEvent[]> {
    handle = buildRunner(fixture.name, { stateDir: join(dir, ".state") });
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
    "streams deltas, a final text and a terminal done",
    async () => {
      const events = await collect();
      const types = events.map((e) => e.type);
      expect(types).toContain("assistant_text_delta");
      expect(types).toContain("assistant_text");
      expect(types.at(-1)).toBe("done");
      expect(types).not.toContain("error");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "closes every tool_use with a tool_result",
    async () => {
      const events = await collect();
      const open = new Set<string>();
      for (const event of events) {
        if (event.type === "tool_use") open.add(event.callId);
        if (event.type === "tool_result") open.delete(event.callId);
      }
      expect(events.some((e) => e.type === "tool_use")).toBe(true);
      expect([...open]).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "never emits a tool_result for a call it did not open",
    async () => {
      const events = await collect();
      const opened = new Set<string>();
      for (const event of events) {
        if (event.type === "tool_use") opened.add(event.callId);
        if (event.type !== "tool_result") continue;
        expect(opened.has(event.callId)).toBe(true);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
