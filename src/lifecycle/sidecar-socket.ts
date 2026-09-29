import WebSocket from "ws";
import {
  CHANNEL_MESSAGE_MAX_BYTES,
  SIDECAR_SOCKET_PATH,
} from "../constants/channels";
import { SIDECAR_LOOPBACK_HOST } from "../constants/sidecar";
import {
  ensureSidecarRunning,
  getSidecarClientToken,
  getSidecarPort,
} from "./spawn-sidecar";

const HANDSHAKE_TIMEOUT_MS = 5_000;

/** Raised when no sidecar can be reached, so the caller answers 503. */
class SidecarUnavailableError extends Error {
  constructor() {
    super("dms-ai sidecar is not reachable");
  }
}

function openSocket(url: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${token}` },
      maxPayload: CHANNEL_MESSAGE_MAX_BYTES,
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
    });
    const onError = (): void => reject(new SidecarUnavailableError());
    socket.once("error", onError);
    socket.once("open", () => {
      socket.off("error", onError);
      socket.pause();
      resolve(socket);
    });
  });
}

/**
 * Opens a WebSocket to the sidecar over loopback. The client credential stays
 * on the server: it travels as a Bearer header the sidecar already accepts.
 * Reviving the sidecar first means opening a channel also respawns one that
 * idle-exited, as the status probe does. The socket comes back paused, so no
 * frame is emitted before its consumer is listening.
 */
export async function connectSidecarSocket(): Promise<WebSocket> {
  await ensureSidecarRunning();
  const port = getSidecarPort();
  const token = getSidecarClientToken();
  if (port === null || !token) throw new SidecarUnavailableError();
  return openSocket(
    `ws://${SIDECAR_LOOPBACK_HOST}:${port}${SIDECAR_SOCKET_PATH}`,
    token,
  );
}
