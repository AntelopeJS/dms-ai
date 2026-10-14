import type { Vocabulary } from "./types";

/** How a tool call was allowed (sidecar `AllowedBy`). */
export const ALLOWED_BY: Vocabulary = {
  read_auto: { icon: "i-ph-eye", tone: "neutral" },
  builder_auto: { icon: "i-ph-hammer", tone: "secondary" },
  approved: { icon: "i-ph-check-circle", tone: "success" },
  rule: { icon: "i-ph-key", tone: "info" },
  full_auto: { icon: "i-ph-lightning", tone: "warning" },
  blocked: { icon: "i-ph-shield-warning", tone: "warning" },
  denied: { icon: "i-ph-prohibit", tone: "error" },
  expired: { icon: "i-ph-timer", tone: "neutral" },
};

/** What came out of a tool call (activity `result`). */
export const ACTIVITY_RESULTS: Vocabulary = {
  done: { icon: "i-ph-check", tone: "success" },
  pending: { icon: "i-ph-hand-palm", tone: "warning" },
  failed: { icon: "i-ph-warning-circle", tone: "error" },
  denied: { icon: "i-ph-prohibit", tone: "error" },
  blocked: { icon: "i-ph-shield-warning", tone: "warning" },
  stopped: { icon: "i-ph-stop-circle", tone: "neutral" },
  expired: { icon: "i-ph-timer", tone: "neutral" },
};

/** The audit log's tabs (activity `category`). */
export const ACTIVITY_CATEGORIES: Vocabulary = {
  changed: { icon: "i-ph-git-diff", tone: "secondary" },
  asked: { icon: "i-ph-hand-palm", tone: "warning" },
  denied: { icon: "i-ph-prohibit", tone: "error" },
  failed: { icon: "i-ph-warning-circle", tone: "error" },
};

/** The coding agents. */
export const AGENTS: Vocabulary = {
  claude: { icon: "i-ph-robot", tone: "neutral" },
  codex: { icon: "i-ph-robot", tone: "neutral" },
};

/** The groups tools belong to. */
export const TOOL_SOURCES: Vocabulary = {
  builder: { icon: "i-ph-hammer", tone: "secondary" },
  project: { icon: "i-ph-folder", tone: "neutral" },
  code: { icon: "i-ph-code", tone: "neutral" },
  web: { icon: "i-ph-globe", tone: "info" },
  assistant: { icon: "i-ph-sparkle", tone: "secondary" },
};

/** The scope a change set was made in. */
export const CHANGE_SCOPES: Vocabulary = {
  safe: { icon: "i-ph-shield-check", tone: "success" },
  vibe: { icon: "i-ph-code", tone: "secondary" },
};

/** Whether a change set is still applied. */
export const CHANGE_STATES: Vocabulary = {
  applied: { icon: "i-ph-check", tone: "success" },
  undone: { icon: "i-ph-arrow-counter-clockwise", tone: "neutral" },
};

/** Where a skill comes from. */
export const SKILL_SOURCES: Vocabulary = {
  module: { icon: "i-ph-package", tone: "secondary" },
  local: { icon: "i-ph-desktop", tone: "warning" },
};
