import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type {
  AppSettings,
  ChatMode,
  ThinkingLevel,
} from "../../state/settings-types.js";

// Neutral settings rendered in the SDK's own vocabulary, the mirror of what
// providers/codex/config.ts does for the app-server. Both providers read the
// same AppSettings; only the translation differs.
export const PERMISSION_MODE_BY_MODE: Record<ChatMode, PermissionMode> = {
  normal: "default",
  acceptEdits: "acceptEdits",
  plan: "plan",
};

/**
 * The SDK permission mode these settings put a session in. Never
 * `bypassPermissions`: in that mode the CLI approves every tool call itself and
 * never asks `canUseTool`, so Full auto runs in `default` and lets the
 * permission bus answer (see agent/effective-mode.ts).
 */
export function resolvePermissionMode(settings: AppSettings): PermissionMode {
  return PERMISSION_MODE_BY_MODE[settings.mode];
}

// Mapped to setMaxThinkingTokens. On adaptive-thinking models (Opus 4.6+) the
// value acts as on/off (0 = disabled) plus a budget ceiling; on models that
// honor explicit budgets the levels stay meaningful.
export const THINKING_TOKENS: Record<ThinkingLevel, number> = {
  off: 0,
  low: 4096,
  medium: 12288,
  high: 24576,
};
