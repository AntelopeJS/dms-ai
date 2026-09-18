import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";
import { PROVIDER_FIXTURES } from "../helpers/provider-fixtures.js";
import {
  answerPermission,
  collectUntil,
  isTerminal,
  openIframe,
  sendHello,
  sendUserMessage,
  startWsHarness,
  type WsHarness,
} from "../helpers/ws-harness.js";

const CONVERSATION_ID = "conv-flow-1";
const RUN_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;

describe.each(PROVIDER_FIXTURES)(
  "user_message → WS flow on $name",
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
      "forwards runner events as wire events ending in run_done",
      async () => {
        fixture.use("plain");
        harness = await startWsHarness({ provider: fixture.name });
        client = await openIframe(harness.port);
        const collected = collectUntil(client, {
          timeoutMs: RUN_TIMEOUT_MS,
          until: isTerminal,
          // A recorded turn may need a decision on its way through; the flow
          // under test is the event plumbing, not the verdict.
          onMessage: (msg, socket) => {
            if (msg.type !== "permission_request") return;
            answerPermission(socket, msg, PERMISSION_DECISIONS.ALLOW_ONCE);
          },
        });
        sendHello(client, CONVERSATION_ID);
        sendUserMessage(client, CONVERSATION_ID, "list");
        const events = await collected;
        const types = events.map((e) => e.type);
        expect(types).toContain("assistant_message_chunk");
        expect(types.at(-1)).toBe("run_done");
        expect(events.at(-1)?.conversationId).toBe(CONVERSATION_ID);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "records which provider produced the transcript",
      async () => {
        fixture.use("plain");
        harness = await startWsHarness({ provider: fixture.name });
        client = await openIframe(harness.port);
        const collected = collectUntil(client, {
          timeoutMs: RUN_TIMEOUT_MS,
          until: isTerminal,
          onMessage: (msg, socket) => {
            if (msg.type !== "permission_request") return;
            answerPermission(socket, msg, PERMISSION_DECISIONS.ALLOW_ONCE);
          },
        });
        sendHello(client, CONVERSATION_ID);
        sendUserMessage(client, CONVERSATION_ID, "list");
        await collected;
        expect(harness.conversationStore.get(CONVERSATION_ID)?.provider).toBe(
          fixture.name,
        );
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "pairs every tool_call_start with a tool_call_end",
      async () => {
        fixture.use("plain");
        harness = await startWsHarness({ provider: fixture.name });
        client = await openIframe(harness.port);
        const collected = collectUntil(client, {
          timeoutMs: RUN_TIMEOUT_MS,
          until: isTerminal,
          onMessage: (msg, socket) => {
            if (msg.type !== "permission_request") return;
            answerPermission(socket, msg, PERMISSION_DECISIONS.ALLOW_ONCE);
          },
        });
        sendHello(client, CONVERSATION_ID);
        sendUserMessage(client, CONVERSATION_ID, "list");
        const events = await collected;
        const open = new Set<string>();
        for (const event of events) {
          if (event.type === "tool_call_start") open.add(String(event.callId));
          if (event.type === "tool_call_end") open.delete(String(event.callId));
        }
        expect([...open]).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
