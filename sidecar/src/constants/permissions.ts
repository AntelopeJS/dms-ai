export const PERMISSION_DECISIONS = {
  ALLOW_ONCE: "allow_once",
  ALLOW_RULE: "allow_rule",
  DENY: "deny",
  DENY_ALL: "deny_all",
} as const;

/** How a request ended without an answer of the user's own. */
export const PERMISSION_SETTLEMENTS = {
  EXPIRED: "expired",
  CANCELLED: "cancelled",
} as const;

export const PERMISSION_LOG_PREFIX = "[permission]";
export const PERMISSION_TIMEOUT_REASON = "permission request timed out";
export const PERMISSION_UNKNOWN_REQUEST_REASON = "unknown request id";

export const PERMISSION_DENIED_MESSAGE = "Permission denied by user.";
export const PERMISSION_FEEDBACK_PREFIX = "The user denied this and said: ";
export const PERMISSION_EXPIRED_MESSAGE =
  "The permission request expired before the user answered, so it was denied. Do not retry it on your own: tell the user what you wanted to do, and they can ask again.";
export const PERMISSION_DENY_ALL_MESSAGE =
  "The user denied this and every other pending request, and stopped the turn.";

/**
 * The dependency manifests, lockfiles and package-manager settings an edit
 * changes dependencies through, and the files a package manager runs or reads
 * at install time.
 */
export const DEPENDENCY_FILE_NAMES: ReadonlySet<string> = new Set(
  [
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lockb",
    "bun.lock",
    "npm-shrinkwrap.json",
    "pnpm-workspace.yaml",
    ".npmrc",
    ".pnpmfile.cjs",
    ".yarnrc.yml",
    ".yarnrc",
    "bunfig.toml",
  ].map((name) => name.toLowerCase()),
);

const LEFTHOOK_CONFIG_NAMES = ["", "."].flatMap((dot) =>
  ["", "-local"].flatMap((local) =>
    ["yml", "yaml", "json", "jsonc", "toml"].map(
      (extension) => `${dot}lefthook${local}.${extension}`,
    ),
  ),
);

/**
 * The files that make git run code: everything inside a `.git` directory at
 * any depth (the hooks and config of the repository, of a submodule under
 * `.git/modules` and of a worktree under `.git/worktrees`; `core.hooksPath`
 * and `core.fsmonitor` name any program), and the config of the hook
 * managers. Each is a path ending, matched on lower-cased segments; `**`
 * stands for one or more trailing segments.
 */
export const GIT_HOOK_PATHS: readonly string[] = [
  ".git/**",
  ".husky/**",
  ...LEFTHOOK_CONFIG_NAMES,
  ".pre-commit-config.yaml",
  ".pre-commit-config.yml",
];

export const SDK_PERMISSION_BEHAVIOR = {
  ALLOW: "allow",
  DENY: "deny",
} as const;
