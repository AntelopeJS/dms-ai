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
import {
  denialMessage,
  type PermissionBus,
  type PermissionOutcome,
} from "../../agent/permission-bus.js";
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
import { isMutatingBuilderTool } from "../../agent/tool-kinds.js";
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
import { SDK_PERMISSION_BEHAVIOR } from "../../constants/permissions.js";
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
import { resolvePermissionMode, THINKING_TOKENS } from "./config.js";
import { createInputQueue, type InputQueue } from "./input-queue.js";
import { resolveClaudeBinary } from "./resolve-binary.js";
import { buildSafeModeHooks, type SdkHooks } from "./safe-mode.js";
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
  hooks: SdkHooks;
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
  hooks: SdkHooks;
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

function buildBasePromptOptions(input: PromptOptionsInput): PromptOptions {
  const base: PromptOptions = {
    systemPrompt: {
      type: SYSTEM_PROMPT_PRESET_TYPE,
      preset: SYSTEM_PROMPT_PRESET_NAME,
      append: input.systemPrompt,
    },
    settingSources: SDK_SETTING_SOURCES_ISOLATED,
    includePartialMessages: SDK_INCLUDE_PARTIAL_MESSAGES,
    permissionMode: resolvePermissionMode(input.settings),
    hooks: input.hooks,
    thinking: buildThinkingConfig(input.settings),
    abortController: input.abortController,
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
  const base = buildBasePromptOptions(input);
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

function buildDenyResult(outcome: PermissionOutcome): SdkPermissionDeny {
  const denial: SdkPermissionDeny = {
    behavior: SDK_PERMISSION_BEHAVIOR.DENY,
    message: denialMessage(outcome),
  };
  return outcome.shouldInterrupt === true
    ? { ...denial, interrupt: true }
    : denial;
}

/**
 * Asks the permission bus about one call and renders its outcome for the SDK:
 * the user's own words become the denial message the agent reads.
 */
export async function bridgeCanUseTool(
  bus: PermissionBus,
  conversationId: string,
  toolName: string,
  input: Record<string, unknown>,
  callId?: string,
): Promise<PermissionResult> {
  const outcome = await bus.requestPermission({
    conversationId,
    toolName,
    args: input,
    callId,
  });
  return outcome.isAllowed ? buildAllowResult(input) : buildDenyResult(outcome);
}

function isFirstPartyMcpTool(toolName: string): boolean {
  return FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES.has(toolName);
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
  ctx: ProviderSessionContext;
  readRoots: string[];
}

function allowAutomatically(
  deps: CanUseToolDeps,
  toolName: string,
  input: Record<string, unknown>,
  callId: string,
): Promise<PermissionResult> {
  const allowedBy = isMutatingBuilderTool(toolName)
    ? "builder_auto"
    : "read_auto";
  deps.ctx.onToolDecision?.({ callId, toolName, allowedBy });
  return Promise.resolve(buildAllowResult(input));
}

function buildCanUseTool(deps: CanUseToolDeps): CanUseTool {
  const { ctx } = deps;
  return (toolName, input, options) => {
    // The SDK's built-in AskUserQuestion cannot render in the chat, so
    // bounce the agent to our own AskUser MCP tool instead of dead-ending at a
    // permission prompt the host can't show.
    if (toolName === ASK_USER_QUESTION_BUILTIN_TOOL_NAME) {
      return Promise.resolve(buildAskUserRedirectResult());
    }
    const callId = options.toolUseID;
    // The module's own MCP tools (the FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES set)
    // are first-party — the documented workflow drives them constantly — so
    // auto-allow them instead of prompting. Builder deletions are gated inside
    // their own handler, which claims the call announced here.
    if (isFirstPartyMcpTool(toolName)) {
      ctx.onToolAnnounced?.(callId, toolName, input);
      return allowAutomatically(deps, toolName, input, callId);
    }
    // Read-only inspection of in-workspace files (the project and its sibling
    // local modules) is non-mutating, so auto-allow it. Writes, shell and
    // network tools still prompt.
    if (
      isAutoAllowedRead(toolName, input, deps.readRoots, ctx.hostProjectRoot)
    ) {
      return allowAutomatically(deps, toolName, input, callId);
    }
    return bridgeCanUseTool(
      deps.bus,
      ctx.conversationId,
      toolName,
      input,
      callId,
    );
  };
}

function resolveCanUseTool(
  ctx: ProviderSessionContext,
  moduleRoots: string[],
  skillRoots: string[],
): CanUseTool | undefined {
  if (ctx.permissionBus === undefined) return undefined;
  // Skill source dirs are auto-allowed for read-only tools too, so the agent can
  // read SKILL.md bodies and supporting files without prompting.
  const readRoots = resolveReadRoots(ctx.hostProjectRoot, [
    ...moduleRoots,
    ...skillRoots,
  ]);
  return buildCanUseTool({ bus: ctx.permissionBus, ctx, readRoots });
}

interface ProviderConfig {
  sdk?: LoadedSdk;
  timeoutMs: number;
  moduleRoots: string[];
  skillDirs: SkillSource[];
}

// Mutable settings cell shared by the session and the safe-mode hook, so a
// safe/vibe flip is seen by the hook without rebuilding the SDK options.
interface LiveSettings {
  settings: AppSettings;
}

// The Claude half of a session: the SDK stream, the prompt queue it consumes,
// and the settings cell the safe-mode hook reads live.
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
    .setPermissionMode(resolvePermissionMode(settings))
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
    close: () => {
      backend.queue.close();
      return Promise.resolve();
    },
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
    hooks: buildSafeModeHooks({
      getGenerationMode: () => activeGenerationMode(live),
      onBlocked: (callId, toolName) =>
        ctx.onToolDecision?.({ callId, toolName, allowedBy: "blocked" }),
      beforeMutation: ctx.beforeMutation,
    }),
    canUseTool: resolveCanUseTool(
      ctx,
      config.moduleRoots,
      skillSources.map((s) => s.dir),
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
    dispose: (reason) => state.session.dispose(reason),
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
