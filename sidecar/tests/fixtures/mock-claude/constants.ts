export const MOCK_DEFAULT_SCRIPT_RELATIVE = "scripts/list-files.json";
export const MOCK_STREAM_DELAY_MS = 50;
export const MOCK_SCRIPT_ENV_VAR = "MOCK_CLAUDE_SCRIPT";
export const MOCK_ABORT_REASON = "aborted";
export const MOCK_CAN_USE_TOOL_BEHAVIOR_ALLOW = "allow";
export const MOCK_INTERRUPTED_RESULT = "interrupted";
// Mirrors MOCK_CODEX_TRACE: what the SDK was asked to load, written out so a
// scenario can read it back.
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
