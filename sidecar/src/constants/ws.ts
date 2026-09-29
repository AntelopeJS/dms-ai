/**
 * The sidecar's one WebSocket endpoint. The DMS backend bridges each dashboard
 * tab to it with a single socket, which says hello as the host and as the chat.
 */
export const WS_PATH = "/ws";

export const WS_LOG_PREFIX = "[ws]";
