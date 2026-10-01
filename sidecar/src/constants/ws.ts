export const WS_PATHS = {
  IFRAME: "/ws/iframe",
  HOST: "/ws/host",
} as const;

export const WS_LOG_PREFIX = "[ws]";

/** RFC 6455 "going away": the server is shutting down. */
export const WS_GOING_AWAY_CODE = 1001;
/** How long a client told to go has to close before it is cut off. */
export const WS_CLIENT_CLOSE_GRACE_MS = 1_000;
