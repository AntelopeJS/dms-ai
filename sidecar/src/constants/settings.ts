import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type {
  AppSettings,
  ChatboxMode,
  ThinkingLevel,
} from "../state/settings-types.js";

export const SETTINGS_FILE_NAME = "settings.json";
export const SETTINGS_LOG_PREFIX = "[dms-ai sidecar settings]";

export const DEFAULT_SETTINGS: AppSettings = {
  mode: "normal",
  thinking: "medium",
  generationMode: "safe",
  allowLocalSkills: false,
};

// In safe mode the agent may act ONLY through the Builder (MCP) tools and
// read-only inspection; these raw-mutation tools are blocked so it cannot write
// bespoke code. Enforced live by the permission callback (not baked per session),
// so a mode flip takes effect immediately without discarding the conversation.
export const SAFE_MODE_DISALLOWED_TOOLS = [
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
];

export const SAFE_MODE_DENIED_MESSAGE =
  'Safe generation mode is active: raw file edits are blocked. Use the Builder ("Builder…") MCP tools instead. If the change genuinely can\'t be done through the Builder, ask the user to switch to Vibe mode for this step.';

// Mapped to setMaxThinkingTokens. On adaptive-thinking models (Opus 4.6+) the
// value acts as on/off (0 = disabled) plus a budget ceiling; on models that
// honor explicit budgets the levels stay meaningful.
export const THINKING_TOKENS: Record<ThinkingLevel, number> = {
  off: 0,
  low: 4096,
  medium: 12288,
  high: 24576,
};

export const PERMISSION_MODE_BY_MODE: Record<ChatboxMode, PermissionMode> = {
  normal: "default",
  acceptEdits: "acceptEdits",
  plan: "plan",
  auto: "bypassPermissions",
};
