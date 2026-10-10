export const PERMISSION_DECISIONS = {
  ALLOW_ONCE: "allow_once",
  ALLOW_RULE: "allow_rule",
  DENY: "deny",
  DENY_ALL: "deny_all",
} as const;

/** How a request ended without an answer of the user's own. */
export const PERMISSION_SETTLEMENTS = {
  EXPIRED: "expired",
  CANCELLED: "cancelled",
} as const;

export const PERMISSION_LOG_PREFIX = "[permission]";
export const PERMISSION_TIMEOUT_REASON = "permission request timed out";
export const PERMISSION_UNKNOWN_REQUEST_REASON = "unknown request id";

export const PERMISSION_DENIED_MESSAGE = "Permission denied by user.";
export const PERMISSION_FEEDBACK_PREFIX = "The user denied this and said: ";
export const PERMISSION_EXPIRED_MESSAGE =
  "The permission request expired before the user answered, so it was denied. Do not retry it on your own: tell the user what you wanted to do, and they can ask again.";
export const PERMISSION_DENY_ALL_MESSAGE =
  "The user denied this and every other pending request, and stopped the turn.";

export const SDK_PERMISSION_BEHAVIOR = {
  ALLOW: "allow",
  DENY: "deny",
} as const;
