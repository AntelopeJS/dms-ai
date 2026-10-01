import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { RUNNER_CLOSED_MESSAGE } from "../../src/constants/agent.js";
import { codexHomeFor } from "../../src/providers/codex/process.js";
import { readRecordedPids } from "../helpers/codex-pids.js";
import { CODEX_FIXTURE, codexOnSigterm } from "../helpers/provider-fixtures.js";
import {
  createCollector,
  openIframe,
  sendHello,
  sendUserMessage,
  startWsHarness,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

const RUNNING_CONVERSATION = "conv-shutdown-running";
const LATE_CONVERSATION = "conv-shutdown-late";
const WAIT_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = 30_000;

function isRunErrorOf(conversationId: string) {
  return (event: WireMessage): boolean =>
    event.type === "run_error" && event.conversationId === conversationId;
}

describe("a shutdown under way", () => {
  let harness: WsHarness | undefined;
  const clients: WebSocket[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.terminate();
    CODEX_FIXTURE.reset();
    await harness?.close();
    harness = undefined;
  });

  it(
    "refuses a message with a run error, opens no session, and completes with a client still connected",
    async () => {
      CODEX_FIXTURE.use("permission");
      codexOnSigterm("linger");
      harness = await startWsHarness({ provider: "codex" });
      const stateDir = join(harness.tmpDir, ".state");
      const running = await openIframe(harness.port);
      const late = await openIframe(harness.port);
      clients.push(running, late);
      const runningEvents = createCollector(running, WAIT_TIMEOUT_MS);
      const lateEvents = createCollector(late, WAIT_TIMEOUT_MS);
      sendHello(running, RUNNING_CONVERSATION);
      sendHello(late, LATE_CONVERSATION);
      sendUserMessage(running, RUNNING_CONVERSATION, "list the files");
      await runningEvents.next((event) => event.type === "permission_request");

      const stopping = harness.shutdown();
      sendUserMessage(late, LATE_CONVERSATION, "too late");
      const refused = await lateEvents.next(isRunErrorOf(LATE_CONVERSATION));
      await stopping;

      expect(refused.error).toBe(RUNNER_CLOSED_MESSAGE);
      expect(existsSync(codexHomeFor(stateDir, LATE_CONVERSATION))).toBe(false);
      expect(await readRecordedPids(stateDir)).toEqual([]);
      expect(running.readyState).toBe(WebSocket.CLOSED);
      expect(late.readyState).toBe(WebSocket.CLOSED);
    },
    TEST_TIMEOUT_MS,
  );
});
