import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import {
  BRIDGE_CLOSE_CODE,
  CHANNEL_EVENTS,
  type ChannelName,
} from "../constants/channels";
import type { SseStream } from "./sse-stream";

const EMPTY_PAYLOAD = "{}";

/** One sidecar socket of a stream: what a posted message is addressed to. */
export interface ChannelBridge {
  id: string;
  userId: string;
  channel: ChannelName;
  /** Writes one client message to the sidecar; false once the socket is gone. */
  forward: (message: Buffer) => Promise<boolean>;
  /** Closes the whole stream, every socket of it included. */
  close: () => void;
}

export interface ChannelSocket {
  channel: ChannelName;
  socket: WebSocket;
}

export interface BridgeOptions {
  userId: string;
  sockets: readonly ChannelSocket[];
  stream: SseStream;
  /** Runs before anything can close a bridge, then `onClosed` exactly once. */
  onOpened: (bridge: ChannelBridge) => void;
  onClosed: (bridge: ChannelBridge) => void;
}

interface OpenBridge {
  bridge: ChannelBridge;
  socket: WebSocket;
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

/** Sidecar frames out as events named after the channel, pausing on a full sink. */
function relayFrames(opened: OpenBridge, stream: SseStream): void {
  const { socket, bridge } = opened;
  socket.on("message", (data) => {
    if (stream.send(bridge.channel, rawDataToText(data))) return;
    if (stream.isClosed()) return;
    socket.pause();
    stream.onDrain(() => socket.resume());
  });
}

function announce(opened: readonly OpenBridge[], stream: SseStream): void {
  const connections = Object.fromEntries(
    opened.map(({ bridge }) => [bridge.channel, bridge.id]),
  );
  stream.send(CHANNEL_EVENTS.READY, JSON.stringify({ connections }));
}

/**
 * Bridges one browser event stream to one sidecar socket per channel, handed
 * over paused and resumed once every listener is in place. The first event maps
 * each channel to the connection id its messages are posted to. The stream and
 * its sockets live and die together: the browser leaving closes every socket,
 * and any socket closing sends `sidecar_down` then ends the stream.
 */
export function openBridges(options: BridgeOptions): ChannelBridge[] {
  const { stream } = options;
  let isOpen = true;
  const teardown = (): void => {
    if (!isOpen) return;
    isOpen = false;
    stream.close();
    for (const { bridge, socket } of opened) {
      socket.close(BRIDGE_CLOSE_CODE);
      options.onClosed(bridge);
    }
  };
  const opened: OpenBridge[] = options.sockets.map(({ channel, socket }) => ({
    socket,
    bridge: {
      id: randomUUID(),
      userId: options.userId,
      channel,
      forward: (message) => forwardTo(socket, message),
      close: teardown,
    },
  }));
  for (const { bridge } of opened) options.onOpened(bridge);
  for (const { socket } of opened) {
    socket.on("error", () => undefined);
    socket.once("close", () => {
      if (!isOpen) return;
      stream.send(CHANNEL_EVENTS.SIDECAR_DOWN, EMPTY_PAYLOAD);
      teardown();
    });
  }
  stream.onClose(teardown);
  for (const entry of opened) relayFrames(entry, stream);
  announce(opened, stream);
  for (const { socket } of opened) socket.resume();
  return opened.map(({ bridge }) => bridge);
}
