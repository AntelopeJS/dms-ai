import { SIDECAR_UNAVAILABLE_STATUS } from "./sidecar";

/** Base of the routes the browser reaches the sidecar through. */
export const CHANNEL_ROUTE_PREFIX = "/ai/channel";
export const CHANNEL_EVENTS_ROUTE = "/events";
export const CHANNEL_MESSAGES_ROUTE = "/:connectionId/messages";
export const CONNECTION_ID_PARAM = "connectionId";

/**
 * The sidecar's one WebSocket endpoint. Each tab's stream is bridged to a
 * single socket there, which the dashboard identifies as the host and as the
 * chat: browsers keep at most six HTTP/1.1 connections per origin, and every
 * dashboard tab already holds two long-lived ones for the DMS itself.
 */
export const SIDECAR_SOCKET_PATH = "/ws";

export const CHANNEL_EVENTS = {
  READY: "ready",
  /** A sidecar frame, relayed unparsed under the stream's default event name. */
  FRAME: "message",
  SIDECAR_DOWN: "sidecar_down",
} as const;

export const SSE_CONTENT_TYPE = "text/event-stream";
export const SSE_OK_STATUS = 200;
export const SSE_KEEPALIVE_INTERVAL_MS = 15_000;
export const SSE_KEEPALIVE_FRAME = ": keepalive\n\n";
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
  Connection: "keep-alive",
};

/**
 * Mirror of the sidecar's WebSocket frame cap (sidecar/src/constants/attachments.ts):
 * a message carries up to ten 25 MiB attachments base64-encoded, about 335 MiB.
 * Posted messages and relayed frames are held to the same ceiling.
 */
export const CHANNEL_MESSAGE_MAX_BYTES = 384 * 1024 * 1024;

/** Sidecar sockets one user may hold open at once: one per stream, eight tabs. */
export const CHANNEL_MAX_SOCKETS_PER_USER = 8;

/**
 * Bytes of posted messages held in memory at once, across every request. A
 * request is counted from its Content-Length, or as a full message without one,
 * and is refused before its body is read once the budget is spent.
 */
export const CHANNEL_PENDING_MESSAGES_MAX_BYTES = 2 * CHANNEL_MESSAGE_MAX_BYTES;

export const CHANNEL_STATUS = {
  ACCEPTED: 204,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  SERVICE_UNAVAILABLE: SIDECAR_UNAVAILABLE_STATUS,
} as const;

/** Close code sent to the sidecar when the browser side of a bridge goes away. */
export const BRIDGE_CLOSE_CODE = 1001;
