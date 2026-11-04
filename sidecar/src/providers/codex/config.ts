import path from "node:path";
import { effectiveGenerationMode } from "../../builder/capability.js";
import {
  CHATGPT_TOKEN_SECRET_ENV,
  CHATGPT_TOKEN_URL_ENV,
  CODEX_AUTH_COMMAND_TIMEOUT_MS,
  CODEX_AUTH_REFRESH_INTERVAL_MS,
} from "../../constants/chatgpt.js";
import {
  CODEX_DENIAL_REMINDER_COUNT_TOKEN,
  CODEX_DENIAL_REMINDER_TEMPLATE,
  CODEX_DENIAL_REMINDER_THRESHOLD,
  CODEX_MCP_SERVER_ID,
  CODEX_MCP_TOKEN_ENV_VAR,
  CODEX_MODEL_PROVIDER_BASE_URL,
  CODEX_MODEL_PROVIDER_ID,
  CODEX_MODEL_PROVIDER_NAME,
  CODEX_MODEL_PROVIDER_WIRE_API,
} from "../../constants/codex.js";
import { MCP_TOOL_TIMEOUT_SEC } from "../../constants/mcp.js";
import { SAFE_MODE_DENIED_MESSAGE } from "../../constants/settings.js";
import type {
  AppSettings,
  ThinkingLevel,
  TurnSettings,
} from "../../state/settings-types.js";
import {
  buildPermissionProfileToml,
  CODEX_READ_ONLY_PROFILE,
  type CodexPermissionInput,
} from "./permission-profiles.js";
import type { v2 } from "./protocol/index.js";

/**
 * Every mode runs read-only + on-request rather than Codex's native
 * workspace-write "auto": in workspace-write an edit inside the roots asks for
 * nothing, while every write under read-only escalates, which is the prompt per
 * write that the Claude path gives. Accept edits included, so it asks before
 * every file edit as Ask first does.
 */
const CODEX_APPROVAL_POLICY: v2.AskForApproval = "on-request";

/**
 * Codex has no "reasoning off": the current models reject `minimal` and accept
 * low, medium, high, xhigh and max. `off` therefore maps to the lowest level
 * available rather than disabling anything.
 */
const CODEX_EFFORT_BY_THINKING: Record<ThinkingLevel, string> = {
  off: "low",
  low: "low",
  medium: "medium",
  high: "high",
};

export interface CodexTurnOverrides {
  approvalPolicy: v2.AskForApproval;
  permissions: typeof CODEX_READ_ONLY_PROFILE;
  effort: string;
}

/**
 * Plan mode declines every escalation instead of prompting: Codex has no
 * non-experimental plan mode of its own. Safe mode does too, whatever the chat
 * mode says: the Builder MCP tools write through the host over HTTP, so they
 * are outside the sandbox and keep working.
 */
export function declinesEscalations(settings: TurnSettings): boolean {
  return settings.mode === "plan" || isSafeMode(settings);
}

/**
 * Overrides sent with every `turn/start`. They persist for subsequent turns,
 * but resending them is what makes a live settings change take effect.
 */
export function buildTurnOverrides(settings: TurnSettings): CodexTurnOverrides {
  return {
    approvalPolicy: CODEX_APPROVAL_POLICY,
    permissions: CODEX_READ_ONLY_PROFILE,
    effort: CODEX_EFFORT_BY_THINKING[settings.thinking],
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export interface CodexConfigInput extends CodexPermissionInput {
  mcpUrl: string;
  /** The Node binary the auth command runs on: the sidecar's own. */
  nodePath: string;
}

/**
 * Run by Codex whenever it needs a bearer token: asks the sidecar for the
 * current one and prints it. Inline, so it runs the same from `src` under the
 * tests as from `dist`; the URL and secret come from the app-server's
 * environment, so nothing secret is written into the file.
 */
const AUTH_COMMAND_SCRIPT = [
  `const response = await fetch(process.env.${CHATGPT_TOKEN_URL_ENV}, {`,
  `  headers: { authorization: "Bearer " + process.env.${CHATGPT_TOKEN_SECRET_ENV} },`,
  "});",
  "const body = await response.text();",
  "if (!response.ok) { process.stderr.write(body); process.exit(1); }",
  "process.stdout.write(body);",
].join("\n");

function tomlArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

/**
 * `config.toml` for the isolated CODEX_HOME. The MCP server has to be declared
 * at process level: placed in `thread/start.config` it is silently ignored.
 * The bearer token travels through an environment variable, never the file,
 * which is world-readable within the user's account.
 *
 * The model provider is the user's ChatGPT plan. Codex runs the auth command
 * for a token at most every CODEX_AUTH_REFRESH_INTERVAL_MS and again after a
 * 401, so a token refreshed by the sidecar reaches a running app-server without
 * restarting it, even in the middle of a turn.
 *
 * Top-level keys come first: in TOML every key after a table header belongs to
 * that table, and --strict-config rejects the misplacement outright. The host
 * project's AGENTS.md is not ours to inject, hence `project_doc_max_bytes = 0`.
 * `tool_timeout_sec` is raised because Codex abandons a tool call after 60 s by
 * default, while AskUser and the Builder deletion gate wait on the user for much
 * longer. The `untrusted` project entry keeps the host project's own .codex
 * layers out of the session, mirroring `settingSources: []` on the Claude path.
 */
export function buildConfigToml(input: CodexConfigInput): string {
  return [
    "project_doc_max_bytes = 0",
    `model_provider = ${tomlString(CODEX_MODEL_PROVIDER_ID)}`,
    `default_permissions = ${tomlString(CODEX_READ_ONLY_PROFILE)}`,
    "",
    `[model_providers.${CODEX_MODEL_PROVIDER_ID}]`,
    `name = ${tomlString(CODEX_MODEL_PROVIDER_NAME)}`,
    `base_url = ${tomlString(CODEX_MODEL_PROVIDER_BASE_URL)}`,
    `wire_api = ${tomlString(CODEX_MODEL_PROVIDER_WIRE_API)}`,
    "requires_openai_auth = false",
    "supports_websockets = false",
    "",
    `[model_providers.${CODEX_MODEL_PROVIDER_ID}.auth]`,
    `command = ${tomlString(input.nodePath)}`,
    `args = ${tomlArray(["--input-type=module", "-e", AUTH_COMMAND_SCRIPT])}`,
    `timeout_ms = ${CODEX_AUTH_COMMAND_TIMEOUT_MS}`,
    `refresh_interval_ms = ${CODEX_AUTH_REFRESH_INTERVAL_MS}`,
    "",
    `[mcp_servers.${CODEX_MCP_SERVER_ID}]`,
    `url = ${tomlString(input.mcpUrl)}`,
    `bearer_token_env_var = ${tomlString(CODEX_MCP_TOKEN_ENV_VAR)}`,
    `tool_timeout_sec = ${MCP_TOOL_TIMEOUT_SEC}`,
    "",
    `[projects.${tomlString(path.resolve(input.hostProjectRoot))}]`,
    'trust_level = "untrusted"',
    "",
    ...buildPermissionProfileToml(input),
  ].join("\n");
}

/**
 * Whether a turn runs in safe mode: requested, and the Builder is present.
 * Safe mode without the Builder has no write route at all, so it degrades to
 * vibe rather than declining everything, as on the Claude path.
 */
export function isSafeMode(settings: AppSettings): boolean {
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
