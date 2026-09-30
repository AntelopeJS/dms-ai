import { HTTPResult, type RequestContext } from "@antelopejs/interface-api";
import type WebSocket from "ws";
import {
  CHANNEL_LIST_SEPARATOR,
  CHANNEL_MAX_SOCKETS_PER_USER,
  CHANNEL_SIDECAR_PATHS,
  CHANNEL_STATUS,
  type ChannelName,
} from "../constants/channels";
import { SIDECAR_UNAVAILABLE_BODY } from "../constants/sidecar";
import { connectSidecarSocket } from "../lifecycle/sidecar-socket";
import { type ChannelSocket, openBridges } from "./bridge";
import {
  findOwnedBridge,
  forgetBridge,
  releaseSockets,
  reserveSockets,
  trackBridge,
} from "./registry";
import { openSseStream } from "./sse-stream";

/** Opens the sidecar socket behind a channel, paused; injectable for tests. */
export type SidecarConnector = (path: string) => Promise<WebSocket>;

const UNKNOWN_CHANNEL = { error: "unknown_channel" };
const UNKNOWN_CONNECTION = { error: "unknown_connection" };
const TOO_MANY_STREAMS = { error: "too_many_streams" };

function isChannelName(value: string): value is ChannelName {
  return Object.hasOwn(CHANNEL_SIDECAR_PATHS, value);
}

function parseChannels(value: string): ChannelName[] | null {
  const names = value.split(CHANNEL_LIST_SEPARATOR);
  if (new Set(names).size !== names.length) return null;
  if (!names.every(isChannelName)) return null;
  return names;
}

async function connectAll(
  connect: SidecarConnector,
  channels: readonly ChannelName[],
): Promise<ChannelSocket[] | null> {
  const attempts = await Promise.allSettled(
    channels.map((channel) => connect(CHANNEL_SIDECAR_PATHS[channel])),
  );
  const sockets = attempts.flatMap((attempt, index) =>
    attempt.status === "fulfilled"
      ? [{ channel: channels[index], socket: attempt.value }]
      : [],
  );
  if (sockets.length === channels.length) return sockets;
  for (const { socket } of sockets) socket.terminate();
  return null;
}

/**
 * Answers `GET …/:channels/events`: bridges the request, as one event stream,
 * to a fresh sidecar socket per channel. Nothing is streamed when the sidecar
 * cannot be reached, so the browser sees a plain 503 and falls back to its probe.
 */
export async function openChannel(
  ctx: RequestContext,
  channels: string,
  userId: string,
  connect: SidecarConnector = connectSidecarSocket,
): Promise<HTTPResult | undefined> {
  const names = parseChannels(channels);
  if (names === null) {
    return new HTTPResult(CHANNEL_STATUS.NOT_FOUND, UNKNOWN_CHANNEL);
  }
  if (!reserveSockets(userId, names.length, CHANNEL_MAX_SOCKETS_PER_USER)) {
    return new HTTPResult(CHANNEL_STATUS.TOO_MANY_REQUESTS, TOO_MANY_STREAMS);
  }
  const sockets = await connectAll(connect, names).finally(() =>
    releaseSockets(userId, names.length),
  );
  if (sockets === null) {
    return new HTTPResult(
      CHANNEL_STATUS.SERVICE_UNAVAILABLE,
      SIDECAR_UNAVAILABLE_BODY,
    );
  }
  openBridges({
    userId,
    sockets,
    stream: openSseStream(ctx),
    onOpened: trackBridge,
    onClosed: forgetBridge,
  });
  return undefined;
}

/**
 * Answers `POST …/:connectionId/messages`: one client protocol message, relayed
 * unparsed to that channel's sidecar socket. Another user's connection id is
 * indistinguishable from an unknown one.
 */
export async function postChannelMessage(
  connectionId: string,
  userId: string,
  message: Buffer,
): Promise<HTTPResult> {
  const bridge = findOwnedBridge(connectionId, userId);
  if (bridge === undefined) {
    return new HTTPResult(CHANNEL_STATUS.NOT_FOUND, UNKNOWN_CONNECTION);
  }
  if (!(await bridge.forward(message))) {
    return new HTTPResult(
      CHANNEL_STATUS.SERVICE_UNAVAILABLE,
      SIDECAR_UNAVAILABLE_BODY,
    );
  }
  return new HTTPResult(CHANNEL_STATUS.ACCEPTED);
}
