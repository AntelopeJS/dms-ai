import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import {
  CODEX_EXITED_MESSAGE,
  CODEX_TRANSPORT_CLOSED_MESSAGE,
} from "../../src/constants/codex.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { CODEX_FIXTURE, codexScript } from "../helpers/provider-fixtures.js";
import { buildRunner, type RunnerHandle } from "../helpers/provider-runner.js";

const CONVERSATION_ID = "conv-codex-death-1";
const TMP_PREFIX = "dms-ai-codex-death-";
/** Long enough that only the app-server's death, not the idle timer, ends the turn. */
const IDLE_WINDOW_MS = 10_000;
const TEST_TIMEOUT_MS = 30_000;

function isDeathReason(message: string): boolean {
  if (message === CODEX_TRANSPORT_CLOSED_MESSAGE) return true;
  return message.startsWith(CODEX_EXITED_MESSAGE);
}

describe("an app-server that dies in the middle of a turn", () => {
  let dir: string;
  let handle: RunnerHandle | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    CODEX_FIXTURE.use("plain");
    process.env.MOCK_CODEX_SCRIPT = codexScript("app-server-crash.jsonl");
  });

  afterEach(async () => {
    await handle?.dispose();
    handle = undefined;
    CODEX_FIXTURE.reset();
    await rm(dir, { recursive: true, force: true });
  });

  it(
    "ends the turn at once, with the reason it died",
    async () => {
      handle = buildRunner("codex", {
        timeoutMs: IDLE_WINDOW_MS,
        stateDir: join(dir, ".state"),
      });
      const startedAt = Date.now();
      const events: RunnerEvent[] = [];
      for await (const event of handle.runner.start("reproduce the mockup", {
        conversationId: CONVERSATION_ID,
        hostProjectRoot: dir,
        getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
      })) {
        events.push(event);
      }
      const failure = events.at(-1);
      expect(failure?.type).toBe("error");
      expect(
        isDeathReason(failure?.type === "error" ? failure.message : ""),
      ).toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(IDLE_WINDOW_MS);
    },
    TEST_TIMEOUT_MS,
  );
});
