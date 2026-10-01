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

// How the app-server takes a SIGTERM. Unset or "die", it dies on the spot, which
// is what the real one does. "linger" keeps writing into its home for a while
// and then exits; "ignore" keeps writing until it is killed.
export const ON_SIGTERM_ENV_VAR = "MOCK_CODEX_ON_SIGTERM";
export const LINGER_ON_SIGTERM = "linger";
export const IGNORE_SIGTERM = "ignore";
export const LINGER_MS = 300;
export const HOME_WRITE_INTERVAL_MS = 10;
export const HOME_WRITE_PREFIX = "written-after-sigterm-";

/** A client request method the fake binary answers with an error. */
export const FAIL_METHOD_ENV_VAR = "MOCK_CODEX_FAIL_METHOD";
export const REFUSED_ERROR_CODE = -32603;
export const REFUSED_MESSAGE_PREFIX = "mock-codex refused";

/**
 * Where the fake binary writes the pid of the long-running command it starts on
 * every turn, the way a turn leaves a shell running. Unset, it starts none.
 */
export const GRANDCHILD_PID_FILE_ENV_VAR = "MOCK_CODEX_GRANDCHILD_PID_FILE";
export const GRANDCHILD_COMMAND = "sleep";
export const GRANDCHILD_ARGS = ["600"];

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

/**
 * Not an app-server frame: a script line that makes the fake binary die where
 * it stands, the way a crashed app-server leaves a turn in flight.
 */
export const EXIT_DIRECTIVE_METHOD = "mock/exit";

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
