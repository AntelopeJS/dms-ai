// Standalone on purpose: a fake binary shares nothing with the sidecar, exactly
// like the real one. Every protocol string here is what the dumps show.
export const JSONRPC_VERSION = "2.0";
export const LINE_SEPARATOR = "\n";

export const SCRIPT_ENV_VAR = "MOCK_CODEX_SCRIPT";
export const SCRIPT_SEPARATOR = ",";
export const TRACE_ENV_VAR = "MOCK_CODEX_TRACE";
export const DELAY_ENV_VAR = "MOCK_CODEX_DELAY_MS";
export const VERSION_ENV_VAR = "MOCK_CODEX_VERSION";
export const MCP_TOKEN_ENV_VAR = "DMS_AI_MCP_TOKEN";
export const CODEX_HOME_ENV_VAR = "CODEX_HOME";

export const DEFAULT_VERSION = "9999.0.0";
export const VERSION_ARGUMENT = "--version";
export const VERSION_PREFIX = "codex-cli ";
export const APP_SERVER_COMMAND = "app-server";
export const DEFAULT_DELAY_MS = 5;

export const DIRECTION_IN = "in";
export const DIRECTION_OUT = "out";

export const TURN_START_METHOD = "turn/start";
export const TURN_INTERRUPT_METHOD = "turn/interrupt";
export const TURN_COMPLETED_METHOD = "turn/completed";
export const ITEM_COMPLETED_METHOD = "item/completed";
export const MCP_TOOL_CALL_ITEM = "mcpToolCall";

export const INTERRUPTED_TURN_STATUS = "interrupted";
export const COMPLETED_ITEM_STATUS = "completed";
export const FAILED_ITEM_STATUS = "failed";

export const MCP_CONFIG_URL_PATTERN = /^url\s*=\s*"(.+)"$/m;
export const CONFIG_FILE_NAME = "config.toml";

export const MCP_CLIENT_NAME = "mock-codex";
export const MCP_CLIENT_VERSION = "0.0.1";
export const AUTHORIZATION_HEADER = "Authorization";
export const BEARER_PREFIX = "Bearer ";

// Answers for calls the loaded dump does not cover. Anything the dump does
// answer is replayed from it instead.
export const FALLBACK_RESULTS = {
  initialize: {
    userAgent: "mock-codex",
    platformFamily: "unix",
    platformOs: "linux",
  },
  "thread/start": { thread: { id: "mock-thread" } },
  "skills/list": { data: [] },
};
export const EMPTY_RESULT = {};
