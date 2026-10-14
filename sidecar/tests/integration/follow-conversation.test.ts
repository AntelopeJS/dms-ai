import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";
import { CLAUDE_FIXTURE } from "../helpers/provider-fixtures.js";
import {
  answerPermission,
  collectUntil,
  isTerminal,
  openChat,
  sendHello,
  sendUserMessage,
  sendWire,
  startWsHarness,
  type WsHarness,
} from "../helpers/ws-harness.js";

const PANEL_CONVERSATION = "conv-panel-shown";
const PALETTE_CONVERSATION = "conv-palette-followed";
const RUN_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;

describe("a chat following a conversation over the tab's socket", () => {
  let harness: WsHarness | undefined;
  let client: WebSocket | undefined;

  afterEach(async () => {
    client?.close();
    client = undefined;
    CLAUDE_FIXTURE.reset();
    await harness?.close();
    harness = undefined;
  });

  it(
    "streams the followed conversation's turn while the socket still shows its own",
    async () => {
      CLAUDE_FIXTURE.use("plain");
      harness = await startWsHarness({ provider: CLAUDE_FIXTURE.name });
      client = await openChat(harness.port);
      sendHello(client, PANEL_CONVERSATION);
      sendWire(client, {
        type: "hello",
        role: "chat",
        conversationId: PALETTE_CONVERSATION,
        follow: true,
      });
      const collected = collectUntil(client, {
        timeoutMs: RUN_TIMEOUT_MS,
        until: isTerminal,
        onMessage: (msg, socket) => {
          if (msg.type !== "permission_request") return;
          answerPermission(socket, msg, PERMISSION_DECISIONS.ALLOW_ONCE);
        },
      });
      sendUserMessage(client, PALETTE_CONVERSATION, "list");
      const events = await collected;
      const turn = events.filter(
        (event) => event.conversationId === PALETTE_CONVERSATION,
      );
      const types = turn.map((event) => event.type);
      expect(types).toContain("assistant_message_chunk");
      expect(types).toContain("run_done");
    },
    TEST_TIMEOUT_MS,
  );
});
