export const MOCK_DEFAULT_SCRIPT_RELATIVE = "scripts/list-files.json";
export const MOCK_STREAM_DELAY_MS = 5;
export const MOCK_SCRIPT_ENV_VAR = "MOCK_CLAUDE_SCRIPT";
/**
 * The model name the mock API turns away, with the script it answers with. Any
 * other model, the default one included, is served the regular script.
 */
export const MOCK_REFUSED_MODEL_ENV_VAR = "MOCK_CLAUDE_REFUSED_MODEL";
export const MOCK_REFUSAL_SCRIPT_RELATIVE = "scripts/model-refused.json";
export const MOCK_DEFAULT_MODEL = "claude-mock";
export const MOCK_ABORT_REASON = "aborted";
export const MOCK_CAN_USE_TOOL_BEHAVIOR_ALLOW = "allow";
export const MOCK_INTERRUPTED_RESULT = "interrupted";
/**
 * Mirrors MOCK_CODEX_TRACE: what the SDK was asked to load, written out so a
 * scenario can read it back.
 */
export const MOCK_TRACE_ENV_VAR = "MOCK_CLAUDE_TRACE";

/**
 * What the CLI approves on its own, before `canUseTool` is asked. Read from the
 * bundled CLI (2.1.131) and confirmed against the real SDK: `acceptEdits`
 * approves the file-edit tools and these filesystem commands, and
 * `bypassPermissions` approves everything, as does `plan` in a process launched
 * in `bypassPermissions`. The CLI also checks that an edited path sits in a
 * working directory, which the scripts do not model.
 */
export const MOCK_ACCEPT_EDITS_TOOLS: readonly string[] = [
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
];
export const MOCK_ACCEPT_EDITS_COMMANDS: readonly string[] = [
  "mkdir",
  "touch",
  "rm",
  "rmdir",
  "mv",
  "cp",
  "sed",
];
/**
 * Commands the CLI deems read-only and runs in every mode without asking
 * `canUseTool`: part of the list the bundled CLI (2.1.131) gives as "always
 * auto-allowed (any args)", confirmed against the real SDK with `wc -l`. The
 * CLI's list is longer (flag-checked `grep`, `rg`, `sed`, `sort`, read-only
 * `git`, `gh` and `docker` subcommands) and it still asks for a path outside
 * the working directories, which the scripts do not model.
 */
export const MOCK_READ_ONLY_COMMANDS: readonly string[] = [
  "cat",
  "head",
  "tail",
  "wc",
  "stat",
  "diff",
  "ls",
  "find",
  "echo",
  "printf",
];
export const MOCK_SHELL_TOOL = "Bash";
export const MOCK_SHELL_COMMAND_ARG = "command";
export const MOCK_BYPASS_MODE = "bypassPermissions";
export const MOCK_PLAN_MODE = "plan";
export const MOCK_ACCEPT_EDITS_MODE = "acceptEdits";
export const MOCK_DEFAULT_MODE = "default";
export const MOCK_PRE_TOOL_USE_EVENT = "PreToolUse";
export const MOCK_HOOK_DENY = "deny";
export const MOCK_BYPASS_UNAVAILABLE_ERROR =
  "Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions";

/**
 * Auto review, as CLI 2.1.316 runs it against the real SDK: its classifier
 * approves or refuses a call without asking `canUseTool`, a hook `ask` hands
 * the call to `canUseTool` instead, and these file tools run unreviewed
 * wherever they point (`Read /etc/hostname` ran without a prompt).
 */
export const MOCK_AUTO_MODE = "auto";
export const MOCK_HOOK_ASK = "ask";
export const MOCK_AUTO_READ_TOOLS: readonly string[] = [
  "Read",
  "LS",
  "Glob",
  "Grep",
  "NotebookRead",
];
/**
 * The model the mock CLI will not run Auto review on: it starts such a session
 * in `default`, refuses `setPermissionMode("auto")` and leaves `auto` when a
 * session moves onto it, as CLI 2.1.316 does for `claude-haiku-4-5-20251001`.
 */
export const MOCK_AUTO_UNSUPPORTED_MODEL_ENV_VAR =
  "MOCK_CLAUDE_AUTO_UNSUPPORTED_MODEL";
export const MOCK_AUTO_UNAVAILABLE_ERROR =
  "Cannot set permission mode to auto: auto mode unavailable for this model";
export const MOCK_INIT_SUBTYPE = "init";
export const MOCK_PERMISSION_DENIED_SUBTYPE = "permission_denied";
