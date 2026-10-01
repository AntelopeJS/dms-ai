import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import { BRIDGE_CLOSE_CODE, CHANNEL_EVENTS } from "../constants/channels";
import type { SseStream } from "./sse-stream";

const EMPTY_PAYLOAD = "{}";

/** The sidecar socket behind one browser stream: what a posted message is addressed to. */
export interface ChannelBridge {
  id: string;
  userId: string;
  /** Writes one client message to the sidecar; false once the socket is gone. */
  forward: (message: Buffer) => Promise<boolean>;
  /** Ends the stream and closes its socket. */
  close: () => void;
}

export interface BridgeOptions {
  userId: string;
  socket: WebSocket;
  stream: SseStream;
  /** Runs before anything can close the bridge, then `onClosed` exactly once. */
  onOpened: (bridge: ChannelBridge) => void;
  onClosed: (bridge: ChannelBridge) => void;
}

function rawDataToText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  return Buffer.from(new Uint8Array(data)).toString("utf8");
}

function forwardTo(socket: WebSocket, message: Buffer): Promise<boolean> {
  if (socket.readyState !== WebSocket.OPEN) return Promise.resolve(false);
  return new Promise((resolve) => {
    socket.send(message, { binary: false }, (error) => resolve(!error));
  });
}

function relayFrames(socket: WebSocket, stream: SseStream): void {
  let isPaused = false;
  socket.on("message", (data) => {
    if (stream.send(CHANNEL_EVENTS.FRAME, rawDataToText(data))) return;
    if (stream.isClosed() || isPaused) return;
    isPaused = true;
    socket.pause();
    stream.onDrain(() => {
      isPaused = false;
      socket.resume();
    });
  });
}

/**
 * Bridges one browser event stream to one sidecar socket, handed over paused
 * and resumed once every listener is in place. The first event carries the
 * connection id messages are posted to. The stream and the socket live and die
 * together: the browser leaving closes the socket, and the socket closing sends
 * `sidecar_down` then ends the stream.
 */
export function openBridge(options: BridgeOptions): ChannelBridge {
  const { socket, stream } = options;
  let isOpen = true;
  function teardown(): void {
    if (!isOpen) return;
    isOpen = false;
    stream.close();
    socket.close(BRIDGE_CLOSE_CODE);
    options.onClosed(bridge);
  }
  const bridge: ChannelBridge = {
    id: randomUUID(),
    userId: options.userId,
    forward: (message) => forwardTo(socket, message),
    close: teardown,
  };
  options.onOpened(bridge);
  socket.on("error", () => undefined);
  socket.once("close", () => {
    if (!isOpen) return;
    stream.send(CHANNEL_EVENTS.SIDECAR_DOWN, EMPTY_PAYLOAD);
    teardown();
  });
  stream.onClose(teardown);
  relayFrames(socket, stream);
  stream.send(
    CHANNEL_EVENTS.READY,
    JSON.stringify({ connectionId: bridge.id }),
  );
  socket.resume();
  return bridge;
}
