import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import {
  type AnyServerEventType,
  EVENT_TYPES,
} from "../../src/protocol/events.js";
import { createChatSocketRegistry } from "../../src/server/chat-socket-registry.js";

const PANEL_CONVERSATION = "conv-panel";
const OTHER_CONVERSATION = "conv-other";
const PALETTE_CONVERSATION = "conv-palette";

interface Tab {
  socket: WebSocket;
  send: ReturnType<typeof vi.fn>;
}

function buildTab(): Tab {
  const send = vi.fn();
  return { socket: { send } as unknown as WebSocket, send };
}

function runDone(conversationId: string): AnyServerEventType {
  return { type: EVENT_TYPES.RUN_DONE, conversationId };
}

function sentConversations(tab: Tab): unknown[] {
  return tab.send.mock.calls.map(
    ([raw]) => JSON.parse(String(raw)).conversationId,
  );
}

describe("a socket following a conversation next to the one it shows", () => {
  it("receives the followed conversation's events without leaving its own", () => {
    const chats = createChatSocketRegistry();
    const tab = buildTab();
    chats.set(PANEL_CONVERSATION, tab.socket);
    chats.follow(PALETTE_CONVERSATION, tab.socket);
    chats.send(PALETTE_CONVERSATION, runDone(PALETTE_CONVERSATION));
    chats.send(PANEL_CONVERSATION, runDone(PANEL_CONVERSATION));
    expect(sentConversations(tab)).toEqual([
      PALETTE_CONVERSATION,
      PANEL_CONVERSATION,
    ]);
  });

  it("keeps following when the socket opens another conversation", () => {
    const chats = createChatSocketRegistry();
    const tab = buildTab();
    chats.follow(PALETTE_CONVERSATION, tab.socket);
    chats.set(PANEL_CONVERSATION, tab.socket);
    chats.set(OTHER_CONVERSATION, tab.socket);
    chats.send(PALETTE_CONVERSATION, runDone(PALETTE_CONVERSATION));
    chats.send(PANEL_CONVERSATION, runDone(PANEL_CONVERSATION));
    expect(sentConversations(tab)).toEqual([PALETTE_CONVERSATION]);
  });

  it("sends an event once to a socket that both shows and follows the conversation", () => {
    const chats = createChatSocketRegistry();
    const tab = buildTab();
    chats.follow(PALETTE_CONVERSATION, tab.socket);
    chats.set(PALETTE_CONVERSATION, tab.socket);
    chats.send(PALETTE_CONVERSATION, runDone(PALETTE_CONVERSATION));
    expect(tab.send).toHaveBeenCalledOnce();
  });

  it("stops following once the socket closes", () => {
    const chats = createChatSocketRegistry();
    const tab = buildTab();
    chats.follow(PALETTE_CONVERSATION, tab.socket);
    chats.clear(tab.socket);
    chats.send(PALETTE_CONVERSATION, runDone(PALETTE_CONVERSATION));
    chats.broadcast(runDone(OTHER_CONVERSATION));
    expect(tab.send).not.toHaveBeenCalled();
  });

  it("routes the followed conversation's host commands to the follower", () => {
    const chats = createChatSocketRegistry();
    const tab = buildTab();
    chats.follow(PALETTE_CONVERSATION, tab.socket);
    expect(chats.socketOf(PALETTE_CONVERSATION)).toBe(tab.socket);
  });
});
