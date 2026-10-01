/**
 * The sidecar's one WebSocket endpoint. The DMS backend bridges each dashboard
 * tab to it with a single socket, which says hello as the host and as the chat.
 */
export const WS_PATH = "/ws";

export const WS_LOG_PREFIX = "[ws]";

/** RFC 6455 "going away": the server is shutting down. */
export const WS_GOING_AWAY_CODE = 1001;
/** How long a client told to go has to close before it is cut off. */
export const WS_CLIENT_CLOSE_GRACE_MS = 1_000;
