import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";
import { PROVIDER_FIXTURES } from "../helpers/provider-fixtures.js";
import {
  createCollector,
  openIframe,
  sendHello,
  sendUserMessage,
  sendWire,
  startWsHarness,
  type WireCollector,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

const CONVERSATION_ID = "conv-queue-1";
const WAIT_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;

const queueSize = (msg: WireMessage): number => (msg.items as unknown[]).length;
const itemIds = (msg: WireMessage): string[] =>
  (msg.items as { id: string }[]).map((item) => item.id);

function enqueue(socket: WebSocket, id: string, content: string): void {
  sendWire(socket, {
    type: "queue_enqueue",
    conversationId: CONVERSATION_ID,
    item: { id, content },
  });
}

function approve(socket: WebSocket, requestId: unknown): void {
  sendWire(socket, {
    type: "permission_response",
    conversationId: CONVERSATION_ID,
    requestId,
    decision: PERMISSION_DECISIONS.ALLOW_ONCE,
  });
}

// Both providers replay a turn that stops on an approval request, which is what
// holds the drain lock open while the queue is exercised.
async function startPausedTurn(
  socket: WebSocket,
): Promise<{ collector: WireCollector; permission: WireMessage }> {
  const collector = createCollector(socket, WAIT_TIMEOUT_MS);
  sendHello(socket, CONVERSATION_ID);
  sendUserMessage(socket, CONVERSATION_ID, "go");
  const permission = await collector.next(
    (e) => e.type === "permission_request",
  );
  return { collector, permission };
}

describe.each(PROVIDER_FIXTURES)(
  "queue protocol while a turn holds the drain lock on $name",
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
      "enqueues, orders, and cancels while paused, then drains after approval",
      async () => {
        fixture.use("permission");
        harness = await startWsHarness({ provider: fixture.name });
        client = await openIframe(harness.port);
        const { collector, permission } = await startPausedTurn(client);

        enqueue(client, "A", "first");
        const afterA = await collector.next(
          (e) => e.type === "queue_state" && queueSize(e) === 1,
        );
        expect(itemIds(afterA)).toEqual(["A"]);

        enqueue(client, "B", "second");
        const afterB = await collector.next(
          (e) => e.type === "queue_state" && queueSize(e) === 2,
        );
        expect(itemIds(afterB)).toEqual(["A", "B"]);

        sendWire(client, {
          type: "queue_cancel",
          conversationId: CONVERSATION_ID,
          id: "A",
        });
        const afterCancel = await collector.next(
          (e) =>
            e.type === "queue_state" &&
            queueSize(e) === 1 &&
            itemIds(e)[0] === "B",
        );
        expect(itemIds(afterCancel)).toEqual(["B"]);

        approve(client, permission.requestId);
        const echo = await collector.next(
          (e) => e.type === "user_message_echo" && e.content === "second",
        );
        expect(echo.content).toBe("second");
        await collector.next(
          (e) => e.type === "queue_state" && queueSize(e) === 0,
        );
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "folds a concurrent immediate message into the queue (no parallel drain)",
      async () => {
        fixture.use("permission");
        harness = await startWsHarness({ provider: fixture.name });
        client = await openIframe(harness.port);
        const { collector, permission } = await startPausedTurn(client);

        sendUserMessage(client, CONVERSATION_ID, "stray immediate");
        const queued = await collector.next(
          (e) =>
            e.type === "queue_state" &&
            (e.items as { content: string }[]).some(
              (item) => item.content === "stray immediate",
            ),
        );
        expect(queueSize(queued)).toBe(1);
        expect(
          collector.events.filter((e) => e.type === "permission_request"),
        ).toHaveLength(1);

        approve(client, permission.requestId);
        const echo = await collector.next(
          (e) =>
            e.type === "user_message_echo" && e.content === "stray immediate",
        );
        expect(echo.content).toBe("stray immediate");
      },
      TEST_TIMEOUT_MS,
    );
  },
);

describe.each(PROVIDER_FIXTURES)(
  "turn failure delivery on $name",
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
      "delivers run_error (not a hang) when the turn fails",
      async () => {
        fixture.use("failing");
        harness = await startWsHarness({ provider: fixture.name });
        client = await openIframe(harness.port);
        const collector = createCollector(client, WAIT_TIMEOUT_MS);
        sendHello(client, CONVERSATION_ID);
        sendUserMessage(client, CONVERSATION_ID, "boom");
        const failure = await collector.next((e) => e.type === "run_error");
        expect(typeof failure.error).toBe("string");
      },
      TEST_TIMEOUT_MS,
    );
  },
);
