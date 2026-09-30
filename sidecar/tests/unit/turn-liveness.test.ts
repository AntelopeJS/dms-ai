import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import type { ProviderName } from "../../src/state/types.js";
import {
  CLAUDE_FIXTURE,
  CODEX_FIXTURE,
  claudeScript,
  codexScript,
} from "../helpers/provider-fixtures.js";
import { buildRunner, type RunnerHandle } from "../helpers/provider-runner.js";

const CONVERSATION_ID = "conv-liveness-1";
const TMP_PREFIX = "dms-ai-liveness-";
/**
 * Shorter than the silent step each script replays (16 events 50 ms apart),
 * longer than the gap between two of its events.
 */
const IDLE_WINDOW_MS = 250;
const CODEX_FRAME_DELAY_MS = "50";
const TEST_TIMEOUT_MS = 30_000;

interface SilentStepScenario {
  name: ProviderName;
  activity: string;
  select: () => void;
  reset: () => void;
}

const SCENARIOS: SilentStepScenario[] = [
  {
    name: "claude",
    activity: "writing",
    select: () => {
      CLAUDE_FIXTURE.use("plain");
      process.env.MOCK_CLAUDE_SCRIPT = claudeScript("long-tool-input.json");
    },
    reset: () => CLAUDE_FIXTURE.reset(),
  },
  {
    name: "codex",
    activity: "thinking",
    select: () => {
      CODEX_FIXTURE.use("plain");
      process.env.MOCK_CODEX_SCRIPT = codexScript("long-reasoning.jsonl");
      process.env.MOCK_CODEX_DELAY_MS = CODEX_FRAME_DELAY_MS;
    },
    reset: () => {
      CODEX_FIXTURE.reset();
      delete process.env.MOCK_CODEX_DELAY_MS;
    },
  },
];

describe.each(SCENARIOS)(
  "a long step with nothing to show on $name",
  (scenario) => {
    let dir: string;
    let handle: RunnerHandle | undefined;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
      scenario.select();
    });

    afterEach(async () => {
      await handle?.dispose();
      handle = undefined;
      scenario.reset();
      await rm(dir, { recursive: true, force: true });
    });

    async function collect(): Promise<RunnerEvent[]> {
      handle = buildRunner(scenario.name, {
        timeoutMs: IDLE_WINDOW_MS,
        stateDir: join(dir, ".state"),
      });
      const events: RunnerEvent[] = [];
      for await (const event of handle.runner.start("reproduce the mockup", {
        conversationId: CONVERSATION_ID,
        hostProjectRoot: dir,
        getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
      })) {
        events.push(event);
      }
      return events;
    }

    it(
      "is not stopped as inactive while the agent keeps working",
      async () => {
        const events = await collect();
        expect(events.filter((event) => event.type === "error")).toEqual([]);
        expect(events.at(-1)?.type).toBe("done");
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "reports what the agent is doing during that step",
      async () => {
        const events = await collect();
        const kinds = events
          .filter((event) => event.type === "activity")
          .map((event) => (event.type === "activity" ? event.kind : null));
        expect(kinds).toContain(scenario.activity);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
