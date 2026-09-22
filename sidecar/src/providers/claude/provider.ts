import os from "node:os";
import path from "node:path";
import type {
  CanUseTool,
  McpSdkServerConfigWithInstance,
  McpServerConfig,
  PermissionMode,
  PermissionResult,
  Query,
  SDKUserMessage,
  SdkPluginConfig,
  SettingSource,
  ThinkingConfig,
} from "@anthropic-ai/claude-agent-sdk";
import type { PermissionBus } from "../../agent/permission-bus.js";
import type {
  AgentProvider,
  AgentProviderOptions,
  ProviderSession,
  ProviderSessionContext,
  TurnInput,
} from "../../agent/provider.js";
import {
  isAutoAllowedRead,
  resolveReadRoots,
} from "../../agent/read-access.js";
import {
  type AgentRunner,
  type AgentRunnerOptions,
  createAgentRunner,
  type RunnerContext,
} from "../../agent/runner.js";
import type { RunnerEvent } from "../../agent/runner-events.js";
import {
  type AgentSession,
  createAgentSession,
  type SessionControls,
} from "../../agent/session.js";
import { buildSystemPrompt } from "../../agent/system-prompt.js";
import { effectiveGenerationMode } from "../../builder/capability.js";
import { TURN_IDLE_TIMEOUT_MS } from "../../constants/agent.js";
import {
  SDK_INCLUDE_PARTIAL_MESSAGES,
  SDK_SETTING_SOURCES_ISOLATED,
  SKILL_PLUGIN_WRAPPER_DIR,
  SYSTEM_PROMPT_PRESET_NAME,
  SYSTEM_PROMPT_PRESET_TYPE,
} from "../../constants/claude.js";
import {
  ASK_USER_QUESTION_BUILTIN_TOOL_NAME,
  ASK_USER_QUESTION_REDIRECT_MESSAGE,
  FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES,
  MCP_SERVER_KEY,
} from "../../constants/mcp.js";
import { STATE_DIR_SEGMENTS } from "../../constants/paths.js";
import {
  PERMISSION_DECISIONS,
  PERMISSION_DENIED_MESSAGE,
  type PermissionDecision,
  SDK_PERMISSION_BEHAVIOR,
} from "../../constants/permissions.js";
import {
  SAFE_MODE_DENIED_MESSAGE,
  SAFE_MODE_DISALLOWED_TOOLS,
} from "../../constants/settings.js";
import { readProjectInfo } from "../../host/project-info.js";
import type { AiMcpServer } from "../../mcp/types.js";
import { buildSkillCatalog } from "../../skills/build-catalog.js";
import { ensurePluginWrapper } from "../../skills/plugin-wrapper.js";
import { resolveSkillSources } from "../../skills/resolve-sources.js";
import type { SkillSource } from "../../skills/types.js";
import type {
  AppSettings,
  GenerationMode,
} from "../../state/settings-types.js";
import type { TokenUsage } from "../../state/types.js";
import { extractTokenUsage, messageToEvents } from "./adapter.js";
import { buildTurnContent, type TurnContent } from "./attachments.js";
import { PERMISSION_MODE_BY_MODE, THINKING_TOKENS } from "./config.js";
import { createInputQueue, type InputQueue } from "./input-queue.js";
import { resolveClaudeBinary } from "./resolve-binary.js";
import { type LoadedSdk, loadSdk } from "./sdk-loader.js";

export type ClaudeRunner = AgentRunner;
export type ClaudeRunnerOptions = AgentProviderOptions & AgentRunnerOptions;
export type { RunnerContext };

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
  return { [MCP_SERVER_KEY]: mcpServer as McpSdkServerConfigWithInstance };
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
  ctx: ProviderSessionContext,
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

interface ProviderConfig {
  sdk?: LoadedSdk;
  timeoutMs: number;
  moduleRoots: string[];
  skillDirs: SkillSource[];
}

// Mutable settings cell shared by the session and the permission callback, so a
// safe/vibe flip is seen by `canUseTool` without rebuilding the SDK options.
interface LiveSettings {
  settings: AppSettings;
}

// The Claude half of a session: the SDK stream, the prompt queue it consumes,
// and the settings cell the permission callback reads live.
interface ClaudeBackend {
  output: Query;
  queue: InputQueue;
  live: LiveSettings;
  hostProjectRoot: string;
  conversationId: string;
}

interface SessionState {
  session: AgentSession;
  backend: ClaudeBackend;
  timeoutMs: number;
}

function activeGenerationMode(live: LiveSettings): GenerationMode {
  return effectiveGenerationMode(live.settings.generationMode);
}

async function loadSharedSdk(config: ProviderConfig): Promise<LoadedSdk> {
  if (config.sdk !== undefined) return config.sdk;
  config.sdk = await loadSdk();
  return config.sdk;
}

async function buildSessionPrompt(
  ctx: ProviderSessionContext,
): Promise<string> {
  const projectInfo = await readProjectInfo(ctx.hostProjectRoot);
  return buildSystemPrompt({
    hostProjectRoot: ctx.hostProjectRoot,
    name: projectInfo.name,
    antelopeModules: projectInfo.antelopeModules,
  });
}

function buildUserMessage(content: TurnContent): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: "",
  };
}

// Flattens the SDK's message stream into the neutral event vocabulary, so the
// session lifecycle never sees an SDKMessage.
async function* toRunnerEvents(
  output: Query,
  onTokenUsage: ((usage: TokenUsage) => void) | undefined,
): AsyncGenerator<RunnerEvent, void> {
  while (true) {
    const result = await output.next();
    if (result.done) return;
    const usage = extractTokenUsage(result.value);
    if (usage !== null) onTokenUsage?.(usage);
    yield* messageToEvents(result.value);
  }
}

async function submitTurn(
  backend: ClaudeBackend,
  input: TurnInput,
): Promise<void> {
  const content = await buildTurnContent(input.text, input.attachments, {
    hostProjectRoot: backend.hostProjectRoot,
    conversationId: backend.conversationId,
  });
  backend.queue.push(buildUserMessage(content));
}

function applyBackendSettings(
  backend: ClaudeBackend,
  settings: AppSettings,
): void {
  backend.live.settings = settings;
  void backend.output
    .setPermissionMode(PERMISSION_MODE_BY_MODE[settings.mode])
    .catch(() => undefined);
  void backend.output
    .setMaxThinkingTokens(THINKING_TOKENS[settings.thinking])
    .catch(() => undefined);
}

function buildSessionControls(backend: ClaudeBackend): SessionControls {
  return {
    submitTurn: (input) => submitTurn(backend, input),
    interrupt: () => {
      void backend.output.interrupt().catch(() => undefined);
    },
    close: () => backend.queue.close(),
    applySettings: (settings) => applyBackendSettings(backend, settings),
  };
}

async function* runTurn(
  state: SessionState,
  input: TurnInput,
  settings: AppSettings,
): AsyncIterable<RunnerEvent> {
  state.backend.live.settings = settings;
  yield* state.session.sendTurn(input, state.timeoutMs);
}

async function buildSessionOptions(
  config: ProviderConfig,
  ctx: ProviderSessionContext,
  live: LiveSettings,
  abortController: AbortController,
): Promise<PromptOptions> {
  // Recomputed at session creation: a flipped `allowLocalSkills` only takes
  // effect for sessions created afterwards (unlike mode/thinking, which
  // applySettings pushes to live sessions in place).
  const skillSources = resolveSkillSources(
    config.skillDirs,
    ctx.settings.allowLocalSkills,
    os.homedir(),
  );
  return buildPromptOptions({
    systemPrompt: await buildSessionPrompt(ctx),
    canUseTool: resolveCanUseTool(
      ctx,
      config.moduleRoots,
      skillSources.map((s) => s.dir),
      () => activeGenerationMode(live),
    ),
    mcpServer: ctx.mcpServer,
    settings: ctx.settings,
    abortController,
    skillLoadout: await buildSkillLoadout(skillSources, ctx.hostProjectRoot),
  });
}

async function createProviderSession(
  config: ProviderConfig,
  ctx: ProviderSessionContext,
): Promise<ProviderSession> {
  const sdk = await loadSharedSdk(config);
  const queue = createInputQueue();
  const abortController = new AbortController();
  const live: LiveSettings = { settings: ctx.settings };
  const options = await buildSessionOptions(config, ctx, live, abortController);
  const backend: ClaudeBackend = {
    output: sdk.query({ prompt: queue.stream, options }),
    queue,
    live,
    hostProjectRoot: ctx.hostProjectRoot,
    conversationId: ctx.conversationId,
  };
  const state: SessionState = {
    session: createAgentSession({
      events: toRunnerEvents(backend.output, ctx.onTokenUsage),
      controls: buildSessionControls(backend),
      abortController,
      onDisposed: ctx.onDisposed,
    }),
    backend,
    timeoutMs: config.timeoutMs,
  };
  return {
    runTurn: (input, settings) => runTurn(state, input, settings),
    interrupt: () => state.session.interrupt(),
    dispose: () => state.session.dispose(),
    applySettings: (settings) => state.session.applySettings(settings),
  };
}

function resolveTimeoutMs(options: AgentProviderOptions | undefined): number {
  if (options === undefined) return TURN_IDLE_TIMEOUT_MS;
  if (options.timeoutMs === undefined) return TURN_IDLE_TIMEOUT_MS;
  return options.timeoutMs;
}

export function createClaudeProvider(
  options?: AgentProviderOptions,
): AgentProvider {
  const config: ProviderConfig = {
    timeoutMs: resolveTimeoutMs(options),
    moduleRoots: options?.moduleRoots ?? [],
    skillDirs: options?.skillDirs ?? [],
  };
  return { createSession: (ctx) => createProviderSession(config, ctx) };
}

export function createClaudeRunner(
  options?: ClaudeRunnerOptions,
): ClaudeRunner {
  return createAgentRunner(createClaudeProvider(options), {
    settings: options?.settings,
  });
}
