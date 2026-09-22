import path from "node:path";
import { effectiveGenerationMode } from "../../builder/capability.js";
import {
  CODEX_AUTH_MODE_API_KEY,
  CODEX_DENIAL_REMINDER_COUNT_TOKEN,
  CODEX_DENIAL_REMINDER_TEMPLATE,
  CODEX_DENIAL_REMINDER_THRESHOLD,
  CODEX_MCP_SERVER_ID,
  CODEX_MCP_TOKEN_ENV_VAR,
} from "../../constants/codex.js";
import { SAFE_MODE_DENIED_MESSAGE } from "../../constants/settings.js";
import type {
  AppSettings,
  ChatboxMode,
  ThinkingLevel,
} from "../../state/settings-types.js";
import type { v2 } from "./protocol/index.js";

export interface CodexModePolicy {
  approvalPolicy: v2.AskForApproval;
  sandbox: v2.SandboxMode;
  networkAccess: boolean;
  writable: boolean;
  // Plan mode declines every escalation instead of prompting: Codex has no
  // non-experimental plan mode of its own.
  autoDeclineEscalations: boolean;
}

// `default` maps to read-only + on-request rather than Codex's native
// workspace-write "auto": in workspace-write an edit inside the roots asks for
// nothing, while every write under read-only escalates — which is the prompt
// per write that the Claude path gives today.
export const CODEX_MODE_POLICIES: Record<ChatboxMode, CodexModePolicy> = {
  normal: {
    approvalPolicy: "on-request",
    sandbox: "read-only",
    networkAccess: false,
    writable: false,
    autoDeclineEscalations: false,
  },
  // Accepting edits is about writes, not about the network: the Claude path
  // grants no egress here, and granting it would be a difference the user never
  // asked for when they picked the other backend.
  acceptEdits: {
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    networkAccess: false,
    writable: true,
    autoDeclineEscalations: false,
  },
  plan: {
    approvalPolicy: "on-request",
    sandbox: "read-only",
    networkAccess: false,
    writable: false,
    autoDeclineEscalations: true,
  },
  // Full access writes everywhere by definition; `writable` is not read for
  // this sandbox, and saying false would describe a restriction that is not
  // there.
  auto: {
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    networkAccess: true,
    writable: true,
    autoDeclineEscalations: false,
  },
};

// Codex has no "reasoning off": the current models reject `minimal` and accept
// low, medium, high, xhigh and max. `off` therefore maps to the lowest level
// available rather than disabling anything.
export const CODEX_EFFORT_BY_THINKING: Record<ThinkingLevel, string> = {
  off: "low",
  low: "low",
  medium: "medium",
  high: "high",
};

export interface CodexTurnOverrides {
  approvalPolicy: v2.AskForApproval;
  sandboxPolicy: v2.SandboxPolicy;
  effort: string;
}

export interface CodexWorkspace {
  hostProjectRoot: string;
  moduleRoots: readonly string[];
}

function writableRoots(workspace: CodexWorkspace): string[] {
  const roots = [workspace.hostProjectRoot, ...workspace.moduleRoots];
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function buildSandboxPolicy(
  policy: CodexModePolicy,
  workspace: CodexWorkspace,
): v2.SandboxPolicy {
  if (policy.sandbox === "danger-full-access")
    return { type: "dangerFullAccess" };
  if (!policy.writable) {
    return { type: "readOnly", networkAccess: policy.networkAccess };
  }
  return {
    type: "workspaceWrite",
    writableRoots: writableRoots(workspace),
    networkAccess: policy.networkAccess,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

/**
 * Policy in force for a conversation. Safe mode pins the sandbox to read-only
 * whatever the chatbox mode says: the Builder MCP tools write through the host
 * over HTTP, so they are outside the sandbox and keep working.
 */
export function resolveModePolicy(settings: AppSettings): CodexModePolicy {
  const base = CODEX_MODE_POLICIES[settings.mode];
  // Through effectiveGenerationMode, as the Claude path does: safe mode without
  // the Builder loaded has no write route at all, so it degrades to vibe rather
  // than declining everything.
  if (effectiveGenerationMode(settings.generationMode) !== "safe") return base;
  return {
    ...base,
    sandbox: "read-only",
    writable: false,
    networkAccess: false,
    autoDeclineEscalations: true,
  };
}

/**
 * Overrides sent with every `turn/start`. They persist for subsequent turns,
 * but resending them is what makes a live settings change take effect.
 */
export function buildTurnOverrides(
  settings: AppSettings,
  workspace: CodexWorkspace,
): CodexTurnOverrides {
  const policy = resolveModePolicy(settings);
  return {
    approvalPolicy: policy.approvalPolicy,
    sandboxPolicy: buildSandboxPolicy(policy, workspace),
    effort: CODEX_EFFORT_BY_THINKING[settings.thinking],
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export interface CodexConfigInput {
  mcpUrl: string;
  hostProjectRoot: string;
}

/**
 * `config.toml` for the isolated CODEX_HOME. The MCP server has to be declared
 * at process level: placed in `thread/start.config` it is silently ignored.
 * The bearer token travels through an environment variable, never the file,
 * which is world-readable within the user's account.
 */
export function buildConfigToml(input: CodexConfigInput): string {
  return [
    // Top-level keys first: in TOML every key after a table header belongs to
    // that table, and --strict-config rejects the misplacement outright.
    // The host project's AGENTS.md is not ours to inject.
    "project_doc_max_bytes = 0",
    "",
    `[mcp_servers.${CODEX_MCP_SERVER_ID}]`,
    `url = ${tomlString(input.mcpUrl)}`,
    `bearer_token_env_var = ${tomlString(CODEX_MCP_TOKEN_ENV_VAR)}`,
    "",
    // Keeps the host project's own .codex layers out of the session, mirroring
    // `settingSources: []` on the Claude path.
    `[projects.${tomlString(path.resolve(input.hostProjectRoot))}]`,
    'trust_level = "untrusted"',
    "",
  ].join("\n");
}

export interface CodexAuthFile {
  auth_mode: string;
  OPENAI_API_KEY: string;
}

export function buildAuthFile(apiKey: string): CodexAuthFile {
  return { auth_mode: CODEX_AUTH_MODE_API_KEY, OPENAI_API_KEY: apiKey };
}

function isSafeMode(settings: AppSettings): boolean {
  return effectiveGenerationMode(settings.generationMode) === "safe";
}

/**
 * Per-thread developer instructions, set once when the thread starts.
 *
 * A Codex decline carries no message: the protocol has no field for one, so the
 * model sees a refusal with no reason. What the Claude path says at the moment
 * of refusal has to be said up front here instead.
 */
export function buildDeveloperInstructions(
  settings: AppSettings,
): string | undefined {
  return isSafeMode(settings) ? SAFE_MODE_DENIED_MESSAGE : undefined;
}

/**
 * The louder reminder, once the agent has been refused repeatedly: a declined
 * patch is immediately retried as a shell command, so a refusal loop is real.
 *
 * It rides on the turn text rather than the developer instructions, which only
 * `thread/start` accepts — restarting the thread to re-say this would throw the
 * conversation's context away to deliver it.
 */
export function buildDenialReminder(
  settings: AppSettings,
  consecutiveDenials: number,
): string | undefined {
  if (!isSafeMode(settings)) return undefined;
  if (consecutiveDenials < CODEX_DENIAL_REMINDER_THRESHOLD) return undefined;
  return CODEX_DENIAL_REMINDER_TEMPLATE.replace(
    CODEX_DENIAL_REMINDER_COUNT_TOKEN,
    String(consecutiveDenials),
  );
}
