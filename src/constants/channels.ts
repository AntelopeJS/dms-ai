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

export const CHANNEL_STATUS = {
  ACCEPTED: 204,
  NOT_FOUND: 404,
  SERVICE_UNAVAILABLE: 503,
} as const;

/** Close code sent to the sidecar when the browser side of a bridge goes away. */
export const BRIDGE_CLOSE_CODE = 1001;
