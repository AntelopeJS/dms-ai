import { MCP_SERVER_KEY } from "./mcp.js";

// Skill the safe-mode prompt sends the agent to. Codex budgets its skill index
// at 2% of the context, so this one has to survive the cut or safe mode loses
// the workflow it tells the agent to follow.
export const SAFE_MODE_SKILL_NAME = "cms-builder-safe";

// Scopes Codex populates on its own. A fresh CODEX_HOME already carries six
// system skills; none of them are part of this product, and they compete for
// the same index budget, so they are switched off whatever the local-skills
// setting says.
export const CODEX_OWNED_SKILL_SCOPES = ["system", "admin"];

export const CODEX_CLI_PACKAGE = "@openai/codex";
export const CODEX_VENDOR_DIR = "vendor";
export const CODEX_BIN_DIR = "bin";
export const CODEX_BINARY_NAME = "codex";
export const CODEX_WINDOWS_BINARY_NAME = "codex.exe";
export const WINDOWS_PLATFORM = "win32";

// Platform packages are npm aliases (`npm:@openai/codex@<version>-<triple>`), so
// they are invisible to a direct resolve and have to be reached from the
// launcher package's own resolution root.
export const CODEX_PLATFORM_PACKAGE_BY_TRIPLE: Record<string, string> = {
  "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
  "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
  "x86_64-apple-darwin": "@openai/codex-darwin-x64",
  "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
  "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
  "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64",
};

export const CODEX_TRIPLE_BY_HOST: Record<string, string> = {
  "linux:x64": "x86_64-unknown-linux-musl",
  "linux:arm64": "aarch64-unknown-linux-musl",
  "darwin:x64": "x86_64-apple-darwin",
  "darwin:arm64": "aarch64-apple-darwin",
  "win32:x64": "x86_64-pc-windows-msvc",
  "win32:arm64": "aarch64-pc-windows-msvc",
};

export const CODEX_VERSION_ARGUMENT = "--version";
export const CODEX_VERSION_PATTERN = /(\d+\.\d+\.\d+)\s*$/;

// Same key the Claude path uses, so a tool reaches the chatbox under one name
// whichever provider ran it.
export const CODEX_MCP_SERVER_ID = MCP_SERVER_KEY;
export const CODEX_MCP_TOKEN_ENV_VAR = "DMS_AI_MCP_TOKEN";
export const CODEX_HOME_ENV_VAR = "CODEX_HOME";
export const CODEX_HOME_DIR_NAME = "codex-home";
export const CODEX_SESSIONS_DIR_NAME = "sessions";
export const CODEX_AUTH_FILE_NAME = "auth.json";
export const CODEX_CONFIG_FILE_NAME = "config.toml";
// codex login --with-api-key writes exactly these two fields, 0600. The binary
// never reads OPENAI_API_KEY from the environment, so the sidecar writes the
// file itself.
export const CODEX_AUTH_MODE_API_KEY = "apikey";
export const CODEX_AUTH_FILE_MODE = 0o600;
export const OPENAI_API_KEY_ENV_VAR = "OPENAI_API_KEY";

// Identifies this client in the thread's originator and user agent, and in
// OpenAI's compliance logs.
export const CODEX_CLIENT_NAME = "antelopejs_cms_ai";

// Fails the spawn on an unknown config key instead of silently ignoring it —
// a version-drift guard on top of the --version check.
export const CODEX_STRICT_CONFIG_FLAG = "--strict-config";
export const CODEX_APP_SERVER_COMMAND = "app-server";

export const JSONRPC_VERSION = "2.0";
export const JSONRPC_LINE_SEPARATOR = "\n";
export const CODEX_LOG_PREFIX = "[dms-ai codex]";

// The app-server is out of process, so its death has to become an error rather
// than a silence: nothing else would ever settle an in-flight request.
export const CODEX_SPAWN_FAILED_MESSAGE = "codex app-server failed to spawn";
export const CODEX_EXITED_MESSAGE = "codex app-server exited";
export const CODEX_TRANSPORT_CLOSED_MESSAGE =
  "codex app-server closed its output stream";
export const CODEX_CLIENT_ABORTED_MESSAGE = "codex app-server is gone";

// Bound on the handshake requests only (initialize, skills, thread/start).
// They run before the session — and therefore before its idle timeout — exists,
// so a binary that accepts the pipes and then never answers would hang the turn
// with nothing watching. A turn itself is never bounded here: that is the
// session's idle timer, which knows the difference between slow and stuck.
export const CODEX_HANDSHAKE_TIMEOUT_MS = 30_000;
export const CODEX_REQUEST_TIMEOUT_MESSAGE = "codex app-server did not answer";

// Kept from the child's stderr and printed when it dies unexpectedly. The stream
// is drained whatever happens: left unread, a full pipe blocks the child itself.
export const CODEX_STDERR_TAIL_BYTES = 2000;

export const CODEX_PID_REGISTRY_FILE = "codex-pids.json";
// Grace left to SIGTERM before SIGKILL. The app-server exits promptly; this only
// covers a wedged child.
export const CODEX_TERMINATE_GRACE_MS = 2000;
export const CODEX_PROC_CMDLINE = "/proc/%pid%/cmdline";

// Codex approval decisions. A decline carries no message — the protocol has no
// field for one — so the redirection to the Builder is carried by the developer
// instructions and the per-turn host-context block instead.
export const CODEX_APPROVAL_DECISIONS = {
  ACCEPT: "accept",
  DECLINE: "decline",
  CANCEL: "cancel",
} as const;

export const CODEX_COMMAND_APPROVAL_METHOD =
  "item/commandExecution/requestApproval";
export const CODEX_FILE_CHANGE_APPROVAL_METHOD =
  "item/fileChange/requestApproval";

// Consecutive declines after which the next turn carries a stronger reminder to
// go through the Builder. Observed behaviour: a declined patch is immediately
// retried as a shell command, so a refusal loop is real, not theoretical.
export const CODEX_DENIAL_REMINDER_THRESHOLD = 2;

// The reminder rides on the turn text: `developerInstructions` is only accepted
// by thread/start, and restarting the thread to re-say something would throw the
// conversation's context away to deliver it.
export const CODEX_DENIAL_REMINDER_TEMPLATE =
  "You have been refused %count% times in a row. Retrying the same write through another route will be refused again: use the Builder tools, or tell the user the change needs Vibe mode.";
export const CODEX_DENIAL_REMINDER_COUNT_TOKEN = "%count%";

// Codex accepts text, image URLs and local image paths, but has no PDF input.
// Rasterizing gives it real perception of the pages instead of a bare path.
// poppler is not guaranteed on a consumer machine, so a failure falls back to
// referencing the file by path.
export const PDF_RASTER_COMMAND = "pdftoppm";
export const PDF_RASTER_FORMAT_FLAG = "-png";
export const PDF_RASTER_DPI_FLAG = "-r";
export const PDF_RASTER_DPI = "150";
export const PDF_RASTER_LAST_PAGE_FLAG = "-l";
export const PDF_RASTER_MAX_PAGES = 20;
export const PDF_RASTER_PREFIX = "page";

export const CODEX_INITIALIZE_METHOD = "initialize";
export const CODEX_INITIALIZED_METHOD = "initialized";
export const CODEX_THREAD_START_METHOD = "thread/start";
export const CODEX_TURN_START_METHOD = "turn/start";
export const CODEX_TURN_INTERRUPT_METHOD = "turn/interrupt";
export const CODEX_TURN_STARTED_NOTIFICATION = "turn/started";
// Emitted once per model call, carrying both the thread total and the cost of
// that call. The per-call figure is the one that adds up across turns.
export const CODEX_TOKEN_USAGE_NOTIFICATION = "thread/tokenUsage/updated";
export const CODEX_SKILLS_EXTRA_ROOTS_METHOD = "skills/extraRoots/set";
export const CODEX_SKILLS_LIST_METHOD = "skills/list";
export const CODEX_SKILLS_CONFIG_WRITE_METHOD = "skills/config/write";
export const CODEX_CLIENT_VERSION = "0.0.1";
export const CODEX_CLIENT_TITLE = "dms-ai";

// Live app-server processes are capped: each is a Rust process holding a model
// connection, and one exists per conversation.
export const CODEX_MAX_LIVE_SESSIONS = 4;

export const CODEX_MISSING_CLI_MESSAGE =
  "[dms-ai] the Codex provider needs @openai/codex; install it to use this provider";
export const CODEX_VERSION_MISMATCH_MESSAGE =
  "[dms-ai] the installed codex binary does not match the protocol types the sidecar ships; refusing to start";
export const CODEX_MISSING_API_KEY_MESSAGE =
  "[dms-ai] the Codex provider needs an OpenAI API key";

export const CODEX_MISSING_RUNTIME_MESSAGE =
  "[dms-ai] the Codex provider was selected but the sidecar runtime did not provide its dependencies";

// Mirrors MOCK_CLAUDE=1 on the Claude path: the provider resolves a fake
// binary that replays a recorded app-server dump instead of the real one. The
// version it reports has to match MOCK_CODEX_VERSION, or the spawn-time version
// gate refuses it — which is how that gate is itself tested.
export const MOCK_CODEX_FLAG_ENV = "MOCK_CODEX";
export const MOCK_CODEX_FLAG_ENABLED = "1";
export const MOCK_CODEX_VERSION_ENV = "MOCK_CODEX_VERSION";
export const MOCK_CODEX_VERSION = "9999.0.0";
export const MOCK_CODEX_BINARY_RELATIVE =
  "../../../tests/fixtures/mock-codex/bin/codex.mjs";

export const CODEX_TURN_FAILED_MESSAGE = "codex turn failed";
export const CODEX_TURN_ABORTED_MESSAGE = "codex turn aborted";
