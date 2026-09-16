import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import {
  type AnyServerEventType,
  EVENT_TYPES,
} from "../../src/protocol/events.js";
import { createHostSocketRegistry } from "../../src/server/host-socket-registry.js";

function buildFakeSocket(): WebSocket {
  return { send: vi.fn() } as unknown as WebSocket;
}

function buildEvent(): AnyServerEventType {
  return { type: EVENT_TYPES.HOST_COMMAND_NAVIGATE, path: "/x" };
}

describe("createHostSocketRegistry", () => {
  it("starts empty", () => {
    const registry = createHostSocketRegistry();
    expect(registry.has()).toBe(false);
  });

  it("set then send dispatches JSON to the held socket", () => {
    const registry = createHostSocketRegistry();
    const socket = buildFakeSocket();
    registry.set(socket);
    registry.send(buildEvent());
    const sendSpy = (socket as unknown as { send: ReturnType<typeof vi.fn> })
      .send;
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const arg = sendSpy.mock.calls[0]?.[0] as string;
    expect(JSON.parse(arg)).toEqual(buildEvent());
  });

  it("clear removes only the matching socket", () => {
    const registry = createHostSocketRegistry();
    const socketA = buildFakeSocket();
    const socketB = buildFakeSocket();
    registry.set(socketA);
    registry.clear(socketB);
    expect(registry.has()).toBe(true);
    registry.clear(socketA);
    expect(registry.has()).toBe(false);
  });

  it("send is a no-op when no socket is set", () => {
    const registry = createHostSocketRegistry();
    expect(() => registry.send(buildEvent())).not.toThrow();
  });
});
