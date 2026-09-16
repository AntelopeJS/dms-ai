import type { StoredState } from "../state/types.js";

export const STATE_DEBOUNCE_MS = 500;
export const STATE_FILE_NAME = "state.json";
export const STATE_LOG_PREFIX = "[dms-ai sidecar state]";

export const STATE_INITIAL: StoredState = { conversations: {} };

export const STATE_FILE_ENCODING = "utf8" as const;
export const STATE_JSON_INDENT = 2;
