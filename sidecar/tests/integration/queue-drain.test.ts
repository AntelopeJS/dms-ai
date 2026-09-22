import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";
import { PROVIDER_FIXTURES } from "../helpers/provider-fixtures.js";
import {
  answerPermission,
  collectUntil,
  openIframe,
  sendHello,
  sendUserMessage,
  startWsHarness,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

const CONVERSATION_ID = "conv-drain-1";
const FOLLOW_UP = "run the follow-up";
const RUN_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;

function autoApprove(msg: WireMessage, socket: WebSocket): void {
  if (msg.type !== "permission_request") return;
  answerPermission(socket, msg, PERMISSION_DECISIONS.ALLOW_ONCE);
}

function enqueue(
  socket: WebSocket,
  conversationId: string,
  content: string,
): void {
  socket.send(
    JSON.stringify({
      type: "queue_enqueue",
      conversationId,
      item: { id: "q1", content },
    }),
  );
}

describe.each(PROVIDER_FIXTURES)(
  "server-driven queue drain on $name",
  (fixture) => {
    let harness: WsHarness | undefined;
    let client: WebSocket | undefined;

    afterEach(async () => {
      client?.close();
      client = undefined;
      fixture.reset();
      await harness?.close();
      harness = undefined;
    });

    it(
      "dequeues an enqueued follow-up server-side and starts its own turn",
      async () => {
        fixture.use("plain");
        harness = await startWsHarness({ provider: fixture.name });
        client = await openIframe(harness.port);
        // The server owns the queue: once the immediate turn completes it
        // dequeues the follow-up itself and echoes its user bubble. Each mock
        // replays one recorded turn, so the drained turn produces no model
        // events of its own — the exactly-once dequeue is what this asserts.
        const collected = collectUntil(client, {
          timeoutMs: RUN_TIMEOUT_MS,
          until: (e) =>
            e.type === "user_message_echo" && e.content === FOLLOW_UP,
          onMessage: autoApprove,
        });
        sendHello(client, CONVERSATION_ID);
        sendUserMessage(client, CONVERSATION_ID, "list");
        enqueue(client, CONVERSATION_ID, FOLLOW_UP);
        const events = await collected;

        const types = events.map((e) => e.type);
        expect(types.indexOf("run_done")).toBeGreaterThanOrEqual(0);
        expect(types.lastIndexOf("run_done")).toBeLessThan(
          types.lastIndexOf("user_message_echo"),
        );
        const queueSizes = events
          .filter((e) => e.type === "queue_state")
          .map((e) => (e.items as unknown[]).length);
        expect(queueSizes).toContain(1);
        expect(queueSizes.at(-1)).toBe(0);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "replays an empty queue on re-attach to clear a stale client mirror",
      async () => {
        fixture.use("plain");
        harness = await startWsHarness({ provider: fixture.name });
        client = await openIframe(harness.port);
        // The server queue is empty; re-attach must still send queue_state so a
        // client whose queue the server drained while away drops its phantoms.
        const collected = collectUntil(client, {
          timeoutMs: RUN_TIMEOUT_MS,
          until: (e) => e.type === "queue_state",
        });
        sendHello(client, CONVERSATION_ID);
        const events = await collected;

        const queueState = events.find((e) => e.type === "queue_state");
        expect(queueState?.items).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
