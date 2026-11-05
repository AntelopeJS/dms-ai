import { describe, expect, it, type Mock, vi } from "vitest";
import {
  type AnyServerEventType,
  EVENT_TYPES,
} from "../../src/protocol/events.js";
import {
  createHostSocketRegistry,
  type SocketSender,
} from "../../src/server/host-socket-registry.js";

function buildFakeSocket(): SocketSender {
  return { send: vi.fn() };
}

interface FakeHost {
  socket: SocketSender;
  send: Mock<(data: string) => void>;
}

function buildFakeHost(): FakeHost {
  const send = vi.fn<(data: string) => void>();
  return { socket: { send }, send };
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
    const { socket, send: sendSpy } = buildFakeHost();
    registry.set(socket);
    registry.send(buildEvent());
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const arg = sendSpy.mock.calls[0]?.[0];
    expect(JSON.parse(String(arg))).toEqual(buildEvent());
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

  it("sends to the preferred host, else to the latest one", () => {
    const registry = createHostSocketRegistry();
    const first = buildFakeHost();
    const second = buildFakeHost();
    registry.set(first.socket);
    registry.set(second.socket);
    registry.send(buildEvent(), first.socket);
    expect(first.send).toHaveBeenCalledTimes(1);
    expect(second.send).not.toHaveBeenCalled();
    registry.clear(first.socket);
    registry.send(buildEvent(), first.socket);
    expect(first.send).toHaveBeenCalledTimes(1);
    expect(second.send).toHaveBeenCalledTimes(1);
  });

  it("falls back to an earlier host once the latest one leaves", () => {
    const registry = createHostSocketRegistry();
    const first = buildFakeHost();
    const second = buildFakeHost();
    registry.set(first.socket);
    registry.set(second.socket);
    registry.clear(second.socket);
    registry.send(buildEvent());
    expect(first.send).toHaveBeenCalledTimes(1);
  });

  it("broadcasts to every host and not only the latest (fails a broadcast that reuses send)", () => {
    const registry = createHostSocketRegistry();
    const first = buildFakeHost();
    const second = buildFakeHost();
    registry.set(first.socket);
    registry.set(second.socket);
    registry.broadcast(buildEvent());
    expect(first.send).toHaveBeenCalledOnce();
    expect(second.send).toHaveBeenCalledOnce();
  });

  it("broadcasts past the sockets already served and the ones that left (fails a broadcast ignoring either)", () => {
    const registry = createHostSocketRegistry();
    const served = buildFakeHost();
    const gone = buildFakeHost();
    const other = buildFakeHost();
    registry.set(served.socket);
    registry.set(gone.socket);
    registry.set(other.socket);
    registry.clear(gone.socket);
    registry.broadcast(buildEvent(), (socket) => socket === served.socket);
    expect(served.send).not.toHaveBeenCalled();
    expect(gone.send).not.toHaveBeenCalled();
    expect(other.send).toHaveBeenCalledOnce();
  });

  it("send is a no-op when no socket is set", () => {
    const registry = createHostSocketRegistry();
    expect(() => registry.send(buildEvent())).not.toThrow();
  });
});
