import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import { BRIDGE_CLOSE_CODE, CHANNEL_EVENTS } from "../constants/channels";
import type { SseStream } from "./sse-stream";

const EMPTY_PAYLOAD = "{}";
const ACTOR_FRAME_TYPE = "actor";
/**
 * A frame can only decode to the actor type if it spells it out, or escapes
 * one of its characters: frames with neither are forwarded unparsed.
 */
const ACTOR_SPELLING = Buffer.from(ACTOR_FRAME_TYPE);
const UNICODE_ESCAPE = Buffer.from("\\u");

/** Who a bridge acts for: the signed-in user the sidecar records. */
export interface ChannelActor {
  userId: string;
  /** Display name stamped on what the user asks for and undoes. */
  name: string;
}

interface TypedFrame {
  type?: unknown;
}

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
  actor: ChannelActor;
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

function mayBeActorFrame(message: Buffer): boolean {
  return message.includes(ACTOR_SPELLING) || message.includes(UNICODE_ESCAPE);
}

/**
 * Whether a browser frame claims to be the actor frame, which only the
 * backend may send: the sidecar would otherwise record whoever it names.
 */
export function isActorFrame(message: Buffer): boolean {
  if (!mayBeActorFrame(message)) return false;
  try {
    const frame = JSON.parse(message.toString("utf8")) as TypedFrame | null;
    return frame?.type === ACTOR_FRAME_TYPE;
  } catch {
    return false;
  }
}

function actorFrame(actor: ChannelActor): string {
  return JSON.stringify({
    type: ACTOR_FRAME_TYPE,
    userId: actor.userId,
    name: actor.name,
  });
}

function forwardTo(socket: WebSocket, message: Buffer): Promise<boolean> {
  if (socket.readyState !== WebSocket.OPEN) return Promise.resolve(false);
  if (isActorFrame(message)) return Promise.resolve(true);
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
 * and resumed once every listener is in place. The socket's first frame names
 * the signed-in user (the actor frame, which a browser frame cannot forge);
 * the stream's first event carries the connection id messages are posted to.
 * The stream and the socket live and die together: the browser leaving closes
 * the socket, and the socket closing sends `sidecar_down` then ends the stream.
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
    userId: options.actor.userId,
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
  socket.send(actorFrame(options.actor));
  stream.send(
    CHANNEL_EVENTS.READY,
    JSON.stringify({ connectionId: bridge.id }),
  );
  socket.resume();
  return bridge;
}
