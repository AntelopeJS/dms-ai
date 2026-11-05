import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { CLAUDE_FIXTURE } from "../helpers/provider-fixtures.js";
import {
  createCollector,
  openChat,
  sendWire,
  startWsHarness,
  type WireCollector,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

const WAIT_MS = 5_000;
const DELETED_CONVERSATION = "conv-deleted";

function isList(msg: WireMessage): boolean {
  return msg.type === "conversation_list";
}

interface Client {
  socket: WebSocket;
  frames: WireCollector;
}

describe("the conversation list a tab's socket receives", () => {
  let harness: WsHarness | undefined;
  let clients: Client[] = [];
  let syncCount = 0;

  afterEach(async () => {
    for (const client of clients) client.socket.close();
    clients = [];
    CLAUDE_FIXTURE.reset();
    await harness?.close();
    harness = undefined;
  });

  async function connect(): Promise<Client> {
    if (harness === undefined) throw new Error("harness not started");
    const socket = await openChat(harness.port);
    const client = { socket, frames: createCollector(socket, WAIT_MS) };
    clients.push(client);
    return client;
  }

  async function start(): Promise<void> {
    CLAUDE_FIXTURE.use("plain");
    harness = await startWsHarness({ provider: CLAUDE_FIXTURE.name });
  }

  /** Everything the server sent the client before it answered a fresh echo. */
  async function framesSoFar(client: Client): Promise<WireMessage[]> {
    syncCount += 1;
    const payload = `sync-${syncCount}`;
    sendWire(client.socket, { type: "echo", payload });
    await client.frames.next(
      (msg) => msg.type === "echo_reply" && msg.payload === payload,
    );
    return client.frames.events;
  }

  async function broadcastFromAnotherSocket(): Promise<void> {
    const requester = await connect();
    sendWire(requester.socket, {
      type: "delete_conversation",
      conversationId: DELETED_CONVERSATION,
    });
    await requester.frames.next(isList);
  }

  it(
    "reaches a host-only socket on broadcast (fails a broadcast that stops at the chat registry)",
    async () => {
      await start();
      const host = await connect();
      sendWire(host.socket, { type: "hello", role: "host" });
      await host.frames.next(isList);
      const before = host.frames.events.filter(isList).length;
      await broadcastFromAnotherSocket();
      const lists = (await framesSoFar(host)).filter(isList);
      expect(lists).toHaveLength(before + 1);
    },
    WAIT_MS * 2,
  );

  it(
    "reaches a socket that is both host and chat once (fails a broadcast to both registries that does not dedupe)",
    async () => {
      await start();
      const tab = await connect();
      sendWire(tab.socket, { type: "hello", role: "host" });
      sendWire(tab.socket, { type: "hello", role: "chat" });
      await tab.frames.next(isList);
      const before = tab.frames.events.filter(isList).length;
      await broadcastFromAnotherSocket();
      const lists = (await framesSoFar(tab)).filter(isList);
      expect(lists).toHaveLength(before + 1);
    },
    WAIT_MS * 2,
  );

  it(
    "still reaches a chat-only socket once (fails a broadcast that moves to the host registry)",
    async () => {
      await start();
      const chat = await connect();
      sendWire(chat.socket, { type: "hello", role: "chat" });
      await framesSoFar(chat);
      const before = chat.frames.events.filter(isList).length;
      await broadcastFromAnotherSocket();
      const lists = (await framesSoFar(chat)).filter(isList);
      expect(lists).toHaveLength(before + 1);
    },
    WAIT_MS * 2,
  );

  it(
    "arrives at once on a host hello (fails a snapshot sent to chat hellos only)",
    async () => {
      await start();
      const host = await connect();
      sendWire(host.socket, { type: "hello", role: "host" });
      const list = await host.frames.next(isList);
      expect(list.conversations).toEqual([]);
    },
    WAIT_MS * 2,
  );
});
