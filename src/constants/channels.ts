/** Base of the routes the browser reaches the sidecar through. */
export const CHANNELS_ROUTE_PREFIX = "/ai/channels";
export const CHANNEL_EVENTS_ROUTE = "/:channels/events";
export const CHANNEL_MESSAGES_ROUTE = "/:connectionId/messages";
export const CHANNELS_PARAM = "channels";
export const CONNECTION_ID_PARAM = "connectionId";

/**
 * Several channels share one stream, `host,chat`: browsers keep at most six
 * HTTP/1.1 connections per origin, and every dashboard tab already holds two
 * long-lived ones for the DMS itself.
 */
export const CHANNEL_LIST_SEPARATOR = ",";

/**
 * Sidecar WebSocket path behind each channel the browser may open. A frame
 * reaches the browser as an event named after its channel.
 */
export const CHANNEL_SIDECAR_PATHS = {
  host: "/ws/host",
  chat: "/ws/iframe",
} as const;

export type ChannelName = keyof typeof CHANNEL_SIDECAR_PATHS;

export const CHANNEL_EVENTS = {
  READY: "ready",
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
