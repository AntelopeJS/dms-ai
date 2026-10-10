export const CHECKPOINTS_GIT_DIR = "checkpoints.git";
export const CHANGE_SETS_FILE_NAME = "change-sets.json";
export const CHECKPOINTS_LOG_PREFIX = "[dms-ai checkpoints]";

export const GIT_COMMAND = "git";
// Generous: the first snapshot of a large project hashes every file.
export const GIT_TIMEOUT_MS = 120_000;
export const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
// Paths handed to one `git checkout` / `git ls-tree`, so a large change set
// never overflows the command line.
export const GIT_PATHS_PER_CALL = 200;

// Always left out of a snapshot, on top of the project's own .gitignore: the
// sidecar state (it lives under node_modules), builds and the host's own data.
export const CHECKPOINT_EXCLUDES: readonly string[] = [
  "node_modules/",
  "dist/",
  ".antelope/",
  ".git/",
];

export const CHECKPOINT_REF_PREFIX = "refs/dms-ai/";
export const BEFORE_REF_SUFFIX = "/before";
export const AFTER_REF_SUFFIX = "/after";

export const GIT_STATUS_BY_LETTER: Record<
  string,
  "added" | "modified" | "deleted"
> = {
  A: "added",
  M: "modified",
  D: "deleted",
  T: "modified",
};

export const BINARY_NUMSTAT = "-";
export const BINARY_DIFF_MARKER = "Binary files";
export const MS_PER_DAY = 86_400_000;
