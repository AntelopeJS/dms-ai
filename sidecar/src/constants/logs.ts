export const LOGS_PATH = "/ai/logs";
export const LOGS_FETCH_TIMEOUT_MS = 5_000;
export const LOGS_LOG_PREFIX = "[logs]";
export const LOGS_FETCH_FAILED_MESSAGE =
  "backend unreachable, log query failed";

export const LOG_LEVEL_ERROR = 40;

export const RELOAD_ERROR_CHANNELS: readonly string[] = [
  "loader.hot-reload",
  "loader.local",
  "cli.command",
];

export const HOST_LOG_SETTLE_MS = 1_500;

export const QUERY_LOGS_TOOL_NAME = "QueryLogs";
export const QUERY_LOGS_TOOL_DESCRIPTION =
  "Queries the host's recent log entries (all modules/levels) so you can see the host's ACTUAL hot-reload / build outcome and runtime errors — things a local type check can't catch. Optional filters: `sinceMs` (epoch ms), `level` (numeric: 40=error, 30=warn), `channel`, `limit`. Returns the matching entries newest-first as JSON.";
export const QUERY_LOGS_EMPTY_MESSAGE =
  "No matching log entries (the backend may still be starting, or nothing matched the filter).";
export const QUERY_LOGS_ERROR_MESSAGE =
  "Could not fetch logs from the backend.";
