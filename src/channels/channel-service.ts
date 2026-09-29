import { HTTPResult, type RequestContext } from "@antelopejs/interface-api";
import type WebSocket from "ws";
import { CHANNEL_STATUS } from "../constants/channels";
import { connectSidecarSocket } from "../lifecycle/sidecar-socket";
import { openBridge } from "./bridge";
import { findOwnedBridge, forgetBridge, trackBridge } from "./registry";
import { openSseStream } from "./sse-stream";

/** Opens the sidecar socket behind a stream, paused; injectable for tests. */
export type SidecarConnector = () => Promise<WebSocket>;

const UNKNOWN_CONNECTION = { error: "unknown_connection" };
const SIDECAR_UNAVAILABLE = { error: "sidecar_unavailable" };

async function tryConnect(
  connect: SidecarConnector,
): Promise<WebSocket | null> {
  try {
    return await connect();
  } catch {
    return null;
  }
}

/**
 * Answers `GET …/events`: bridges the request, as one event stream, to a fresh
 * sidecar socket that carries both the dashboard's and the chat's messages.
 * Nothing is streamed when the sidecar cannot be reached, so the browser sees
 * a plain 503 and falls back to its probe.
 */
export async function openChannel(
  ctx: RequestContext,
  userId: string,
  connect: SidecarConnector = connectSidecarSocket,
): Promise<HTTPResult | undefined> {
  const socket = await tryConnect(connect);
  if (socket === null) {
    return new HTTPResult(
      CHANNEL_STATUS.SERVICE_UNAVAILABLE,
      SIDECAR_UNAVAILABLE,
    );
  }
  openBridge({
    userId,
    socket,
    stream: openSseStream(ctx),
    onOpened: trackBridge,
    onClosed: forgetBridge,
  });
  return undefined;
}

/**
 * Answers `POST …/:connectionId/messages`: one client protocol message, relayed
 * unparsed to that stream's sidecar socket. Another user's connection id is
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
      SIDECAR_UNAVAILABLE,
    );
  }
  return new HTTPResult(CHANNEL_STATUS.ACCEPTED);
}
