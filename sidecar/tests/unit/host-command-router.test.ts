import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import {
  type AnyServerEventType,
  EVENT_TYPES,
} from "../../src/protocol/events.js";
import { createHostCommandRouter } from "../../src/server/host-command-router.js";
import { createHostSocketRegistry } from "../../src/server/host-socket-registry.js";
import { createIframeSocketRegistry } from "../../src/server/iframe-socket-registry.js";

const FIRST_TAB_CONVERSATION = "conv-first-tab";
const SECOND_TAB_CONVERSATION = "conv-second-tab";
const NAVIGATE_EVENT: AnyServerEventType = {
  type: EVENT_TYPES.HOST_COMMAND_NAVIGATE,
  path: "/dashboard/settings",
};

interface Tab {
  socket: WebSocket;
  send: ReturnType<typeof vi.fn>;
}

function buildTab(): Tab {
  const send = vi.fn();
  return { socket: { send } as unknown as WebSocket, send };
}

function openTwoTabs() {
  const hosts = createHostSocketRegistry();
  const chats = createIframeSocketRegistry();
  const first = buildTab();
  const second = buildTab();
  hosts.set(first.socket);
  chats.set(FIRST_TAB_CONVERSATION, first.socket);
  hosts.set(second.socket);
  chats.set(SECOND_TAB_CONVERSATION, second.socket);
  return {
    hosts,
    chats,
    first,
    second,
    route: createHostCommandRouter(hosts, chats),
  };
}

describe("createHostCommandRouter", () => {
  it("sends a conversation's command to the tab carrying it, not the latest host", () => {
    const { first, second, route } = openTwoTabs();
    route(FIRST_TAB_CONVERSATION)(NAVIGATE_EVENT);
    expect(first.send).toHaveBeenCalledWith(JSON.stringify(NAVIGATE_EVENT));
    expect(second.send).not.toHaveBeenCalled();
  });

  it("falls back to the latest host once the conversation's tab is gone", () => {
    const { hosts, chats, first, second, route } = openTwoTabs();
    hosts.clear(first.socket);
    chats.clear(first.socket);
    route(FIRST_TAB_CONVERSATION)(NAVIGATE_EVENT);
    expect(first.send).not.toHaveBeenCalled();
    expect(second.send).toHaveBeenCalledWith(JSON.stringify(NAVIGATE_EVENT));
  });

  it("falls back to the latest host for a conversation no tab carries", () => {
    const { first, second, route } = openTwoTabs();
    route("conv-unopened")(NAVIGATE_EVENT);
    expect(first.send).not.toHaveBeenCalled();
    expect(second.send).toHaveBeenCalledTimes(1);
  });
});
