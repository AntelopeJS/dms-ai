import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";
import { PROVIDER_FIXTURES } from "../helpers/provider-fixtures.js";
import {
  answerPermission,
  createCollector,
  openIframe,
  sendHello,
  sendUserMessage,
  startWsHarness,
  type WsHarness,
} from "../helpers/ws-harness.js";

const CONVERSATION_ID = "conv-resume-1";
const WAIT_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;

describe.each(PROVIDER_FIXTURES)(
  "iframe reconnect resumes a pending permission on $name",
  (fixture) => {
    let harness: WsHarness | undefined;
    let first: WebSocket | undefined;
    let second: WebSocket | undefined;

    afterEach(async () => {
      first?.close();
      second?.close();
      first = undefined;
      second = undefined;
      fixture.reset();
      await harness?.close();
      harness = undefined;
    });

    it(
      "replays the snapshot and the pending request, and the turn still ends",
      async () => {
        fixture.use("permission");
        harness = await startWsHarness({ provider: fixture.name });

        // A real turn, paused on an approval the user never answered.
        first = await openIframe(harness.port);
        const firstEvents = createCollector(first, WAIT_TIMEOUT_MS);
        sendHello(first, CONVERSATION_ID);
        sendUserMessage(first, CONVERSATION_ID, "go");
        await firstEvents.next((e) => e.type === "permission_request");
        first.close();
        first = undefined;

        // The tab comes back: the server owns the pending request, so it is
        // re-sent on hello alongside the transcript.
        second = await openIframe(harness.port);
        const secondEvents = createCollector(second, WAIT_TIMEOUT_MS);
        sendHello(second, CONVERSATION_ID);
        const snapshot = await secondEvents.next(
          (e) => e.type === "conversation_snapshot",
        );
        const permission = await secondEvents.next(
          (e) => e.type === "permission_request",
        );
        expect(snapshot.conversationId).toBe(CONVERSATION_ID);
        expect(permission.conversationId).toBe(CONVERSATION_ID);
        expect(["Bash", "Edit"]).toContain(permission.toolName);

        answerPermission(second, permission, PERMISSION_DECISIONS.DENY);
        const done = await secondEvents.next(
          (e) => e.type === "run_done" || e.type === "run_error",
        );
        expect(done.type).toBe("run_done");
      },
      TEST_TIMEOUT_MS,
    );
  },
);
