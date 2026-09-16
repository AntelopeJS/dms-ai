export const TYPECHECK_COMMAND = "pnpm";
export const TYPECHECK_ARGS: readonly string[] = [
  "exec",
  "tsc",
  "--noEmit",
  "-p",
  "tsconfig.json",
];
export const TYPECHECK_TSCONFIG_FILENAME = "tsconfig.json";
export const TYPECHECK_TIMEOUT_MS = 60_000;
export const TYPECHECK_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
export const TYPECHECK_MAX_SUMMARY_LINES = 30;

export const TYPECHECK_ERROR_LINE_REGEX = /error TS\d+/;

export const TYPECHECK_LOG_PREFIX = "[typecheck]";
export const TYPECHECK_CLEAN_MESSAGE = "No type errors.";
export const TYPECHECK_NO_TSCONFIG_MESSAGE =
  "No tsconfig.json in the target module — skipped type check.";
export const TYPECHECK_UNAVAILABLE_MESSAGE =
  "Could not run tsc (compiler unavailable or misconfigured) — skipped type check.";
export const TYPECHECK_ERRORS_PREFIX = "Type errors found:";

export const TYPECHECK_TOOL_NAME = "Typecheck";
export const TYPECHECK_TOOL_DESCRIPTION =
  "Runs `tsc --noEmit` on a loaded module to catch type errors BEFORE the host hot-reload rebuilds it. Optional `target` selects a module by name (its directory basename) or by an absolute root path; it must be one of the known module/project roots. Defaults to the module owning your most recently edited file, else the host project. Run this after editing a module's source and fix any errors before considering the page done.";
export const TYPECHECK_UNKNOWN_TARGET_PREFIX = "Unknown target: ";
export const TYPECHECK_UNKNOWN_TARGET_SUFFIX =
  " is not a known module/project root. Known targets: ";
