export const SUMMARY_MAX_DETAIL_CHARS = 80;
export const SUMMARY_TRUNCATE_SUFFIX = "...";

export const SUMMARY_LABELS = {
  BASH: "Run shell command",
  EDIT: "Edit file",
  WRITE: "Write file",
  READ: "Read file",
  GLOB: "Glob pattern",
  GREP: "Grep pattern",
  UNKNOWN_PATH: "unknown",
  GENERIC_PREFIX: "Use tool",
} as const;

export const SUMMARY_TOOL_NAMES = {
  BASH: "Bash",
  EDIT: "Edit",
  WRITE: "Write",
  READ: "Read",
  GLOB: "Glob",
  GREP: "Grep",
} as const;
