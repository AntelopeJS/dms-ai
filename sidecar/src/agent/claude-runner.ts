import os from "node:os";
import path from "node:path";
import type {
  CanUseTool,
  McpServerConfig,
  PermissionMode,
  PermissionResult,
  SdkPluginConfig,
  SettingSource,
  ThinkingConfig,
} from "@anthropic-ai/claude-agent-sdk";
import { effectiveGenerationMode } from "../builder/capability.js";
import {
  SDK_INCLUDE_PARTIAL_MESSAGES,
  SDK_SETTING_SOURCES_ISOLATED,
  SDK_TIMEOUT_MS,
  SKILL_PLUGIN_WRAPPER_DIR,
  SYSTEM_PROMPT_PRESET_NAME,
  SYSTEM_PROMPT_PRESET_TYPE,
} from "../constants/agent.js";
import {
  ASK_USER_QUESTION_BUILTIN_TOOL_NAME,
  ASK_USER_QUESTION_REDIRECT_MESSAGE,
  FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES,
  MCP_SERVER_KEY,
} from "../constants/mcp.js";
import { STATE_DIR_SEGMENTS } from "../constants/paths.js";
import {
  PERMISSION_DECISIONS,
  PERMISSION_DENIED_MESSAGE,
  type PermissionDecision,
  SDK_PERMISSION_BEHAVIOR,
} from "../constants/permissions.js";
import {
  DEFAULT_SETTINGS,
  PERMISSION_MODE_BY_MODE,
  SAFE_MODE_DENIED_MESSAGE,
  SAFE_MODE_DISALLOWED_TOOLS,
  THINKING_TOKENS,
} from "../constants/settings.js";
import { readProjectInfo } from "../host/project-info.js";
import type { AiMcpServer } from "../mcp/types.js";
import type { AttachmentType } from "../protocol/messages.js";
import { buildSkillCatalog } from "../skills/build-catalog.js";
import { ensurePluginWrapper } from "../skills/plugin-wrapper.js";
import { resolveSkillSources } from "../skills/resolve-sources.js";
import type { SkillSource } from "../skills/types.js";
import type { CurrentPage } from "../state/host-state.js";
import type { AppSettings, GenerationMode } from "../state/settings-types.js";
import { buildTurnContent } from "./attachments.js";
import { type ClaudeSession, createClaudeSession } from "./claude-session.js";
import { prependHostContext } from "./host-context.js";
import { createInputQueue } from "./input-queue.js";
import type { PermissionBus } from "./permission-bus.js";
import { isAutoAllowedRead, resolveReadRoots } from "./read-access.js";
import { resolveClaudeBinary } from "./resolve-claude-binary.js";
import type { RunnerEvent } from "./runner-events.js";
import { type LoadedSdk, loadSdk } from "./sdk-loader.js";
import { buildSystemPrompt } from "./system-prompt.js";

export interface RunnerContext {
  conversationId: string;
  hostProjectRoot: string;
  // Reads the host's displayed page live. Called at turn start to build the
  // per-turn host-context block, and at session creation for the initial prompt.
  getCurrentPage: () => CurrentPage;
  // Files the user attached to this turn. Images/PDFs are inlined; other files
  // are written under the conversation's uploads dir and referenced by path.
  attachments?: AttachmentType[];
  permissionBus?: PermissionBus;
  mcpServer?: AiMcpServer;
  // Invoked for every tool that actually went through a permission decision
  // (auto-allowed reads/first-party MCP never reach here). Lets the connection
  // layer persist the approve/deny outcome for the activity metrics.
  onPermissionDecision?: (
    toolName: string,
    decision: PermissionDecision,
  ) => void;
}

export interface ClaudeRunner {
  start(message: string, ctx: RunnerContext): AsyncIterable<RunnerEvent>;
  interruptSession(conversationId: string): void;
  disposeSession(conversationId: string): void;
  applySettings(settings: AppSettings): void;
  dispose(): void;
}

export interface ClaudeRunnerOptions {
  timeoutMs?: number;
  settings?: AppSettings;
  // On-disk roots of loaded modules (from interface-core), auto-allowed for
  // read-only tools alongside the host project.
  moduleRoots?: string[];
  // Module-contributed skill sources (from `antelopeJs.skills`), loaded into the
  // agent as local plugins and added to the readable roots.
  skillDirs?: SkillSource[];
}

interface PromptOptions {
  systemPrompt: {
    type: typeof SYSTEM_PROMPT_PRESET_TYPE;
    preset: typeof SYSTEM_PROMPT_PRESET_NAME;
    append: string;
  };
  settingSources: SettingSource[];
  includePartialMessages: boolean;
  permissionMode: PermissionMode;
  thinking: ThinkingConfig;
  pathToClaudeCodeExecutable?: string;
  canUseTool?: CanUseTool;
  mcpServers?: Record<string, McpServerConfig>;
  plugins?: SdkPluginConfig[];
  skills?: string[];
  abortController: AbortController;
}

// The plugins + explicit allowlist needed to load module/local skills. Built
// once per session: a flipped `allowLocalSkills` only affects sessions created
// afterwards — live conversations keep their loadout.
interface SkillLoadout {
  plugins: SdkPluginConfig[];
  skills: string[];
}

interface PromptOptionsInput {
  systemPrompt: string;
  canUseTool: CanUseTool | undefined;
  mcpServer: AiMcpServer | undefined;
  settings: AppSettings;
  abortController: AbortController;
  skillLoadout: SkillLoadout | undefined;
}

function buildThinkingConfig(settings: AppSettings): ThinkingConfig {
  if (settings.thinking === "off") return { type: "disabled" };
  return { type: "enabled", budgetTokens: THINKING_TOKENS[settings.thinking] };
}

function buildBasePromptOptions(
  systemPrompt: string,
  settings: AppSettings,
  abortController: AbortController,
): PromptOptions {
  const base: PromptOptions = {
    systemPrompt: {
      type: SYSTEM_PROMPT_PRESET_TYPE,
      preset: SYSTEM_PROMPT_PRESET_NAME,
      append: systemPrompt,
    },
    settingSources: SDK_SETTING_SOURCES_ISOLATED,
    includePartialMessages: SDK_INCLUDE_PARTIAL_MESSAGES,
    permissionMode: PERMISSION_MODE_BY_MODE[settings.mode],
    thinking: buildThinkingConfig(settings),
    abortController,
  };
  const claudeBinary = resolveClaudeBinary();
  if (claudeBinary === undefined) return base;
  return { ...base, pathToClaudeCodeExecutable: claudeBinary };
}

function buildMcpServersMap(
  mcpServer: AiMcpServer,
): Record<string, McpServerConfig> {
  return { [MCP_SERVER_KEY]: mcpServer };
}

function buildPromptOptions(input: PromptOptionsInput): PromptOptions {
  const base = buildBasePromptOptions(
    input.systemPrompt,
    input.settings,
    input.abortController,
  );
  const withTool =
    input.canUseTool === undefined
      ? base
      : { ...base, canUseTool: input.canUseTool };
  const withMcp =
    input.mcpServer === undefined
      ? withTool
      : { ...withTool, mcpServers: buildMcpServersMap(input.mcpServer) };
  // settingSources stays `[]` (isolation) — skills load via local plugins +
  // an explicit allowlist, never the host's settings sources.
  if (input.skillLoadout === undefined) return withMcp;
  return {
    ...withMcp,
    plugins: input.skillLoadout.plugins,
    skills: input.skillLoadout.skills,
  };
}

// Resolves the skill sources, synthesizes their plugin wrappers, and returns the
// SDK plugins + the explicit `plugin:skill` allowlist. Returns undefined when
// there are no loadable skills so the options omit `plugins`/`skills` entirely.
// NEVER returns `skills:'all'` (Task 1: it leaks every machine skill into context).
async function buildSkillLoadout(
  sources: readonly SkillSource[],
  hostProjectRoot: string,
): Promise<SkillLoadout | undefined> {
  if (sources.length === 0) return undefined;
  const base = path.join(
    hostProjectRoot,
    ...STATE_DIR_SEGMENTS,
    SKILL_PLUGIN_WRAPPER_DIR,
  );
  const wrappers = await Promise.all(
    sources.map((s) => ensurePluginWrapper(s, base)),
  );
  const catalog = await buildSkillCatalog(sources);
  if (catalog.items.length === 0) return undefined;
  return {
    plugins: wrappers.map((w) => ({
      type: "local" as const,
      path: w.pluginPath,
    })),
    skills: catalog.items.map((i) => i.id),
  };
}

type SdkPermissionAllow = Extract<PermissionResult, { behavior: "allow" }>;
type SdkPermissionDeny = Extract<PermissionResult, { behavior: "deny" }>;

function buildAllowResult(input: Record<string, unknown>): SdkPermissionAllow {
  return {
    behavior: SDK_PERMISSION_BEHAVIOR.ALLOW,
    updatedInput: input,
  };
}

function buildDenyResult(): SdkPermissionDeny {
  return {
    behavior: SDK_PERMISSION_BEHAVIOR.DENY,
    message: PERMISSION_DENIED_MESSAGE,
  };
}

const PERMISSION_TO_SDK: Record<
  PermissionDecision,
  (input: Record<string, unknown>) => PermissionResult
> = {
  [PERMISSION_DECISIONS.ALLOW_ONCE]: (input) => buildAllowResult(input),
  [PERMISSION_DECISIONS.ALLOW_SESSION]: (input) => buildAllowResult(input),
  [PERMISSION_DECISIONS.DENY]: () => buildDenyResult(),
};

export async function bridgeCanUseTool(
  bus: PermissionBus,
  conversationId: string,
  toolName: string,
  input: Record<string, unknown>,
  onDecision?: (toolName: string, decision: PermissionDecision) => void,
): Promise<PermissionResult> {
  const decision = await bus.requestPermission({
    conversationId,
    toolName,
    args: input,
  });
  onDecision?.(toolName, decision);
  const mapper = PERMISSION_TO_SDK[decision];
  return mapper(input);
}

function isFirstPartyMcpTool(toolName: string): boolean {
  return FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES.has(toolName);
}

const SAFE_MODE_BLOCKED_TOOLS = new Set(SAFE_MODE_DISALLOWED_TOOLS);

function buildSafeModeDenyResult(): SdkPermissionDeny {
  return {
    behavior: SDK_PERMISSION_BEHAVIOR.DENY,
    message: SAFE_MODE_DENIED_MESSAGE,
  };
}

function buildAskUserRedirectResult(): SdkPermissionDeny {
  return {
    behavior: SDK_PERMISSION_BEHAVIOR.DENY,
    message: ASK_USER_QUESTION_REDIRECT_MESSAGE,
  };
}

/** What the permission gate needs to answer one tool request. */
interface CanUseToolDeps {
  bus: PermissionBus;
  conversationId: string;
  readRoots: string[];
  cwd: string;
  getGenerationMode: () => GenerationMode;
  onDecision?: (toolName: string, decision: PermissionDecision) => void;
}

function buildCanUseTool({
  bus,
  conversationId,
  readRoots,
  cwd,
  getGenerationMode,
  onDecision,
}: CanUseToolDeps): CanUseTool {
  return (toolName, input) => {
    // The SDK's built-in AskUserQuestion cannot render in the chatbox host, so
    // bounce the agent to our own AskUser MCP tool instead of dead-ending at a
    // permission prompt the host can't show.
    if (toolName === ASK_USER_QUESTION_BUILTIN_TOOL_NAME) {
      return Promise.resolve(buildAskUserRedirectResult());
    }
    // Enforced live (not baked per session) so a safe/vibe flip mid-conversation
    // takes effect on the next tool call without discarding the session.
    if (
      getGenerationMode() === "safe" &&
      SAFE_MODE_BLOCKED_TOOLS.has(toolName)
    ) {
      return Promise.resolve(buildSafeModeDenyResult());
    }
    // The module's own MCP tools (the FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES set)
    // are first-party — the documented workflow drives them constantly — so
    // auto-allow them instead of prompting.
    if (isFirstPartyMcpTool(toolName)) {
      return Promise.resolve(buildAllowResult(input));
    }
    // Read-only inspection of in-workspace files (the project and its sibling
    // local modules) is non-mutating, so auto-allow it. Writes, shell and
    // network tools still prompt.
    if (isAutoAllowedRead(toolName, input, readRoots, cwd)) {
      return Promise.resolve(buildAllowResult(input));
    }
    return bridgeCanUseTool(bus, conversationId, toolName, input, onDecision);
  };
}

function resolveCanUseTool(
  ctx: RunnerContext,
  moduleRoots: string[],
  skillRoots: string[],
  getGenerationMode: () => GenerationMode,
): CanUseTool | undefined {
  if (ctx.permissionBus === undefined) return undefined;
  // Skill source dirs are auto-allowed for read-only tools too, so the agent can
  // read SKILL.md bodies and supporting files without prompting.
  const readRoots = resolveReadRoots(ctx.hostProjectRoot, [
    ...moduleRoots,
    ...skillRoots,
  ]);
  return buildCanUseTool({
    bus: ctx.permissionBus,
    conversationId: ctx.conversationId,
    readRoots,
    cwd: ctx.hostProjectRoot,
    getGenerationMode,
    onDecision: ctx.onPermissionDecision,
  });
}

interface SessionManager {
  sdk?: LoadedSdk;
  sessions: Map<string, ClaudeSession>;
  timeoutMs: number;
  settings: AppSettings;
  moduleRoots: string[];
  skillDirs: SkillSource[];
}

function activeGenerationMode(manager: SessionManager): GenerationMode {
  return effectiveGenerationMode(manager.settings.generationMode);
}

async function loadSharedSdk(manager: SessionManager): Promise<LoadedSdk> {
  if (manager.sdk !== undefined) return manager.sdk;
  manager.sdk = await loadSdk();
  return manager.sdk;
}

async function buildSessionPrompt(ctx: RunnerContext): Promise<string> {
  const projectInfo = await readProjectInfo(ctx.hostProjectRoot);
  return buildSystemPrompt({
    hostProjectRoot: ctx.hostProjectRoot,
    name: projectInfo.name,
    antelopeModules: projectInfo.antelopeModules,
  });
}

async function createSession(
  manager: SessionManager,
  ctx: RunnerContext,
): Promise<ClaudeSession> {
  const sdk = await loadSharedSdk(manager);
  const systemPrompt = await buildSessionPrompt(ctx);
  const input = createInputQueue();
  const abortController = new AbortController();
  // Recomputed at session creation: a flipped `allowLocalSkills` only takes
  // effect for sessions created afterwards (unlike mode/thinking, which
  // applySettings pushes to live sessions in place).
  const skillSources = resolveSkillSources(
    manager.skillDirs,
    manager.settings.allowLocalSkills,
    os.homedir(),
  );
  const skillLoadout = await buildSkillLoadout(
    skillSources,
    ctx.hostProjectRoot,
  );
  const options = buildPromptOptions({
    systemPrompt,
    canUseTool: resolveCanUseTool(
      ctx,
      manager.moduleRoots,
      skillSources.map((s) => s.dir),
      () => activeGenerationMode(manager),
    ),
    mcpServer: ctx.mcpServer,
    settings: manager.settings,
    abortController,
    skillLoadout,
  });
  const output = sdk.query({ prompt: input.stream, options });
  return createClaudeSession({
    output,
    input,
    abortController,
    onDisposed: () => manager.sessions.delete(ctx.conversationId),
  });
}

async function getOrCreateSession(
  manager: SessionManager,
  ctx: RunnerContext,
): Promise<ClaudeSession> {
  const existing = manager.sessions.get(ctx.conversationId);
  if (existing !== undefined) return existing;
  const session = await createSession(manager, ctx);
  manager.sessions.set(ctx.conversationId, session);
  return session;
}

async function* startTurn(
  manager: SessionManager,
  message: string,
  ctx: RunnerContext,
): AsyncIterable<RunnerEvent> {
  const session = await getOrCreateSession(manager, ctx);
  const grounded = prependHostContext(
    message,
    ctx.getCurrentPage(),
    activeGenerationMode(manager),
  );
  const content = await buildTurnContent(grounded, ctx.attachments ?? [], {
    hostProjectRoot: ctx.hostProjectRoot,
    conversationId: ctx.conversationId,
  });
  yield* session.sendTurn(content, manager.timeoutMs);
}

function interruptSession(
  manager: SessionManager,
  conversationId: string,
): void {
  const session = manager.sessions.get(conversationId);
  if (session === undefined) return;
  session.interrupt();
}

function disposeSession(manager: SessionManager, conversationId: string): void {
  const session = manager.sessions.get(conversationId);
  if (session === undefined) return;
  manager.sessions.delete(conversationId);
  session.dispose();
}

function disposeAll(manager: SessionManager): void {
  const sessions = [...manager.sessions.values()];
  manager.sessions.clear();
  for (const session of sessions) session.dispose();
}

function applySettings(manager: SessionManager, settings: AppSettings): void {
  // Live sessions keep their context across a settings change. Permission mode and
  // thinking update in place; generationMode is read live by the permission
  // callback (canUseTool) and injected per turn, so a mode flip takes effect on the
  // next turn without tearing down the session.
  manager.settings = settings;
  const permissionMode = PERMISSION_MODE_BY_MODE[settings.mode];
  const thinkingTokens = THINKING_TOKENS[settings.thinking];
  for (const session of manager.sessions.values()) {
    session.setPermissionMode(permissionMode);
    session.setMaxThinkingTokens(thinkingTokens);
  }
}

function resolveTimeoutMs(options: ClaudeRunnerOptions | undefined): number {
  if (options === undefined) return SDK_TIMEOUT_MS;
  if (options.timeoutMs === undefined) return SDK_TIMEOUT_MS;
  return options.timeoutMs;
}

export function createClaudeRunner(
  options?: ClaudeRunnerOptions,
): ClaudeRunner {
  const manager: SessionManager = {
    sessions: new Map(),
    timeoutMs: resolveTimeoutMs(options),
    settings: options?.settings ?? DEFAULT_SETTINGS,
    moduleRoots: options?.moduleRoots ?? [],
    skillDirs: options?.skillDirs ?? [],
  };
  return {
    start: (message, ctx) => startTurn(manager, message, ctx),
    interruptSession: (conversationId) =>
      interruptSession(manager, conversationId),
    disposeSession: (conversationId) => disposeSession(manager, conversationId),
    applySettings: (settings) => applySettings(manager, settings),
    dispose: () => disposeAll(manager),
  };
}
