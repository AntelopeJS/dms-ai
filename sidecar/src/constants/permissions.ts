export const PERMISSION_TIMEOUT_MS = 5 * 60_000;

export const PERMISSION_DECISIONS = {
  ALLOW_ONCE: "allow_once",
  ALLOW_SESSION: "allow_session",
  DENY: "deny",
} as const;

export type PermissionDecision =
  (typeof PERMISSION_DECISIONS)[keyof typeof PERMISSION_DECISIONS];

export const PERMISSION_LOG_PREFIX = "[permission]";
export const PERMISSION_TIMEOUT_REASON = "permission request timed out";
export const PERMISSION_UNKNOWN_REQUEST_REASON = "unknown request id";

export const PERMISSION_DENIED_MESSAGE = "Permission denied by user.";

export const SDK_PERMISSION_BEHAVIOR = {
  ALLOW: "allow",
  DENY: "deny",
} as const;
