import type {
  EffortLevel,
  PermissionMode,
  ThinkingConfig,
} from "@anthropic-ai/claude-agent-sdk";
import { agentEnvironment } from "../../agent/project-secrets.js";
import { CLAUDE_MCP_TOOL_TIMEOUT_ENV_VAR } from "../../constants/claude.js";
import { MCP_TOOL_TIMEOUT_MS } from "../../constants/mcp.js";
import type {
  AppSettings,
  ChatMode,
  ThinkingLevel,
  TurnSettings,
} from "../../state/settings-types.js";

/**
 * Neutral chat modes rendered in the SDK's own vocabulary, the mirror of what
 * providers/codex/config.ts does for the app-server.
 */
const PERMISSION_MODE_BY_MODE: Record<ChatMode, PermissionMode> = {
  normal: "default",
  auto: "auto",
  acceptEdits: "acceptEdits",
  plan: "plan",
};

/**
 * The SDK permission mode these settings put a session in. Never
 * `bypassPermissions`: in that mode the CLI approves every tool call itself and
 * never asks `canUseTool`, so Full auto runs in `default` and lets the
 * permission bus answer (see agent/effective-mode.ts).
 *
 * `auto` is asked for, not granted: the CLI alone knows whether this model,
 * account, its settings and its own circuit breaker allow Auto review, and it
 * refuses by staying in `default`.
 */
export function resolvePermissionMode(settings: TurnSettings): PermissionMode {
  return PERMISSION_MODE_BY_MODE[settings.mode];
}

/** The levels a thinking setting maps to; `max` is model-specific and never sent. */
export type ClaudeEffort = Exclude<EffortLevel, "max">;

/**
 * The CLI's reasoning effort for a thinking level, the mirror of Codex's
 * mapping. `off` has no effort: thinking is disabled outright.
 */
export const CLAUDE_EFFORT_BY_THINKING: Record<
  ThinkingLevel,
  ClaudeEffort | undefined
> = {
  off: undefined,
  low: "low",
  medium: "medium",
  high: "high",
};

/**
 * The SDK options that pick the model and its reasoning depth. Adaptive
 * thinking lets the model size its own budget; effort steers it. `off`
 * disables thinking and sends no effort.
 */
export function resolveModelOptions(settings: AppSettings) {
  const model = settings.claudeModel;
  const effort = CLAUDE_EFFORT_BY_THINKING[settings.thinking];
  if (effort === undefined) {
    return { model, thinking: { type: "disabled" } satisfies ThinkingConfig };
  }
  return {
    model,
    thinking: { type: "adaptive" } satisfies ThinkingConfig,
    effort,
  };
}

export type ClaudeProcessEnv = Record<string, string | undefined>;

type ClaudeEnv = ClaudeProcessEnv &
  Record<typeof CLAUDE_MCP_TOOL_TIMEOUT_ENV_VAR, string>;

/**
 * The CLI's environment: the sidecar's own (the SDK replaces it rather than
 * merging) minus the variables the project's secret files assign, with an MCP
 * tool timeout that outlasts every wait on the user.
 */
export function buildClaudeEnv(
  baseEnv: ClaudeProcessEnv,
  hostProjectRoot: string,
): ClaudeEnv {
  return {
    ...agentEnvironment(baseEnv, hostProjectRoot),
    [CLAUDE_MCP_TOOL_TIMEOUT_ENV_VAR]: String(MCP_TOOL_TIMEOUT_MS),
  };
}
