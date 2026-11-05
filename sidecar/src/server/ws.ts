import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { createCallAudit } from "../audit/call-audit.js";
import { createCallLedger } from "../agent/call-ledger.js";
import { createConversationModes } from "../agent/conversation-modes.js";
import { createEditTracker, type EditTracker } from "../agent/edit-tracker.js";
import {
  createPermissionBus,
  type PermissionBus,
} from "../agent/permission-bus.js";
import type { AgentProviderOptions } from "../agent/provider.js";
import {
  createQuestionBus,
  type QuestionAnswers,
  type QuestionBus,
  type QuestionRequest,
} from "../agent/question-bus.js";
import {
  type AgentRunner,
  type ConversationSettingsResolver,
  createAgentRunner,
  type TurnGrounding,
} from "../agent/runner.js";
import {
  createSwitchingRunner,
  type ProviderRunnerFactory,
} from "../agent/switching-runner.js";
import { TURN_RESTARTED_REASON } from "../agent/turn-end-reasons.js";
import {
  type Checkpoints,
  createCheckpoints,
} from "../checkpoints/checkpoints.js";
import { createShadowGit } from "../checkpoints/shadow-git.js";
import { WS_MAX_PAYLOAD_BYTES } from "../constants/attachments.js";
import { ASK_USER_TOOL_NAME } from "../constants/mcp.js";
import { DEFAULT_SETTINGS } from "../constants/settings.js";
import {
  WS_CLIENT_CLOSE_GRACE_MS,
  WS_GOING_AWAY_CODE,
  WS_LOG_PREFIX,
  WS_PATH,
} from "../constants/ws.js";
import { createAssistantRunner } from "../agent/assistant-runner.js";
import { createAnalystMcpServer } from "../mcp/sdk-binding.js";
import type { AiMcpServerDeps, AiMcpServerStaticDeps } from "../mcp/types.js";
import { PROVIDER_MODULES } from "../providers/registry.js";
import type {
  ProviderHostRuntime,
  ProviderRuntime,
} from "../providers/types.js";
import type { SkillSource } from "../skills/types.js";
import { createChangeSetStore } from "../state/change-sets.js";
import type { AssistantMode } from "../state/assistant-mode.js";
import type { ConversationStore } from "../state/conversations.js";
import type { HostState } from "../state/host-state.js";
import type { SettingsStore } from "../state/settings-store.js";
import type { AppSettings, TurnSettings } from "../state/settings-types.js";
import type { ProviderName } from "../state/types.js";
import {
  broadcastConversationList,
  emitBlockPreview,
  listAttachedImages,
  sendConversationMode,
} from "./chat-events.js";
import { isClientAuthorized } from "./client-auth.js";
import {
  createHostCommandRouter,
  type HostCommandSender,
} from "./host-command-router.js";
import type { HostSocketRegistry } from "./host-socket-registry.js";
import type { SettingsApplier, SidecarBridge } from "./http.js";
import type { IdleShutdownController } from "./idle-shutdown.js";
import {
  createChatSocketRegistry,
  type ChatSocketRegistry,
} from "./chat-socket-registry.js";
import { createLiveTurnStore } from "./live-turns.js";
import type { NavigationCompleter } from "./navigation-completer.js";
import { createPendingQueueStore } from "./pending-queue.js";
import {
  buildBuilderGate,
  interruptConversation,
  onPermissionDecided,
  onPermissionPrompt,
  onQuestionAnswered,
  onQuestionExpired,
  onQuestionPrompt,
  onRulesChanged,
  permissionPolicy,
} from "./permission-events.js";
import { rawDataToText } from "./raw-data.js";
import {
  applySettings,
  buildConnectionContext,
  dispatchMessage,
} from "./routing.js";
import type { RoutingConfig, SidecarServices } from "./services.js";
import { createMcpServerCache } from "./mcp-server-cache.js";
import { createTurnRegistry } from "./turn-registry.js";

export interface AttachWsServerOptions {
  clientToken: string;
  hostProjectRoot: string;
  moduleRoots?: string[];
  skillDirs?: SkillSource[];
  conversationStore: ConversationStore;
  settingsStore?: SettingsStore;
  mcpDeps: AiMcpServerStaticDeps;
  /**
   * What the sidecar's own runtime offers every provider. Neutral: the backends
   * are reached through the registry, never by name from here.
   */
  providerRuntime: ProviderHostRuntime;
  hostState: HostState;
  hostSocketRegistry: HostSocketRegistry;
  navigationCompleter: NavigationCompleter;
  idleController?: IdleShutdownController;
  permissionBus?: PermissionBus;
  chatSocketRegistry?: ChatSocketRegistry;
  settingsApplier?: SettingsApplier;
  /** Started by the caller; absent, change sets are off. */
  checkpoints?: Checkpoints;
  /** Filled with the live services, for the HTTP routes that read them. */
  bridge?: SidecarBridge;
  /** Core's development flag: Builder runs only when it is set. */
  isDevelopment: boolean;
}

const NOOP_IDLE_CONTROLLER: IdleShutdownController = {
  increment: () => {},
  decrement: () => {},
  touch: () => {},
};

const NOOP_SETTINGS_STORE: SettingsStore = {
  get: () => DEFAULT_SETTINGS,
  set: () => {},
  load: () => Promise.resolve(),
  flush: () => Promise.resolve(),
};

interface AttachWsServerResult {
  close: () => Promise<void>;
}

function buildBaseOptions(
  options: AttachWsServerOptions,
  settings: AppSettings,
  profile: AssistantMode,
): AgentProviderOptions {
  return {
    settings,
    moduleRoots: options.moduleRoots ?? [],
    skillDirs: options.skillDirs ?? [],
    profile,
  };
}

/** How one assistant's runners treat a turn, whichever provider runs it. */
interface RunnerProfile {
  mode: AssistantMode;
  resolveSettings: ConversationSettingsResolver;
  ground?: TurnGrounding;
}

/**
 * One factory per registered provider, all built the same way: the registry is
 * the only thing here that knows which backends exist.
 */
function buildRunnerFactories(
  options: AttachWsServerOptions,
  runtime: ProviderRuntime,
  profile: RunnerProfile,
): Record<ProviderName, ProviderRunnerFactory> {
  const factoryFor =
    (name: ProviderName): ProviderRunnerFactory =>
    (settings: AppSettings) =>
      createAgentRunner(
        PROVIDER_MODULES[name].create(
          buildBaseOptions(options, settings, profile.mode),
          runtime,
        ),
        {
          settings,
          resolveSettings: profile.resolveSettings,
          ground: profile.ground,
        },
      );
  return { claude: factoryFor("claude"), codex: factoryFor("codex") };
}

function analystSettings(
  _conversationId: string,
  settings: AppSettings,
): TurnSettings {
  return { ...settings, mode: "normal" };
}

function keepMessage(message: string): string {
  return message;
}

/** Analyst's profile: its own session setup on either provider, no host context. */
const ANALYST_PROFILE: RunnerProfile = {
  mode: "analyst",
  resolveSettings: analystSettings,
  ground: keepMessage,
};

function buildRunner(
  options: AttachWsServerOptions,
  settings: AppSettings,
  createMcpDeps: (conversationId: string) => AiMcpServerDeps,
  holder: ServicesHolder,
): AgentRunner {
  const runtime = { ...options.providerRuntime, createMcpDeps };
  const builder = createSwitchingRunner(
    buildRunnerFactories(options, runtime, {
      mode: "builder",
      resolveSettings: (conversationId, global) =>
        services(holder).conversationModes.settingsFor(conversationId, global),
    }),
    settings,
  );
  const analyst = createSwitchingRunner(
    buildRunnerFactories(options, runtime, ANALYST_PROFILE),
    settings,
  );
  return createAssistantRunner({
    runners: { builder, analyst },
    modeOf: (conversationId) =>
      services(holder).conversationModes.state(conversationId).assistant,
  });
}

function bindConnection(socket: WebSocket, config: RoutingConfig): void {
  const ctx = buildConnectionContext(config);
  config.idleController.increment();
  socket.on("message", (data) => {
    const raw = rawDataToText(data);
    dispatchMessage(socket, raw, ctx);
  });
  socket.on("error", (err) => {
    console.warn(`${WS_LOG_PREFIX} socket error: ${err.message}`);
  });
  socket.on("close", (code) => {
    config.hostSocketRegistry.clear(socket);
    config.chatSocketRegistry.clear(socket);
    config.idleController.decrement();
    console.log(`${WS_LOG_PREFIX} close code=${code}`);
  });
}

/**
 * Tools are bound per conversation so AskUser can reach the right chat: no
 * MCP transport carries our conversationId down to a tool handler, so it is
 * closed over here instead. Shared by both bindings.
 */
function buildMcpDepsFactory(
  staticDeps: AiMcpServerStaticDeps,
  holder: ServicesHolder,
  hostCommandsOf: (conversationId: string) => HostCommandSender,
): (conversationId: string) => AiMcpServerDeps {
  return (conversationId) => ({
    ...staticDeps,
    conversationId,
    sendToHost: hostCommandsOf(conversationId),
    requestQuestion: (req) => askUser(services(holder), req),
    getLastEditedFile: () =>
      services(holder).editTracker.getLastEditedFile(conversationId),
    showPreview: (preview) =>
      emitBlockPreview(services(holder), conversationId, preview),
    listAttachedImages: () =>
      listAttachedImages(services(holder), conversationId),
    gateBuilderOp: (toolName, args) =>
      buildBuilderGate(services(holder), conversationId)(toolName, args),
    currentGrant: () => services(holder).turnActors.get(conversationId)?.grant,
  });
}

/** Paired with its AskUser call so the question ends with the call. */
function askUser(
  current: SidecarServices,
  req: QuestionRequest,
): Promise<QuestionAnswers> {
  const callId = current.callLedger.claim(
    req.conversationId,
    ASK_USER_TOOL_NAME,
    { questions: req.questions },
  );
  return current.questionBus.requestQuestion({ ...req, callId });
}

function buildWss(config: RoutingConfig): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: WS_MAX_PAYLOAD_BYTES,
  });
  wss.on("connection", (socket) => {
    bindConnection(socket, config);
  });
  return wss;
}

function extractPath(req: IncomingMessage): string {
  const url = req.url ?? "/";
  return url.split("?")[0] ?? "/";
}

function makeUpgradeHandler(
  wss: WebSocketServer,
  clientToken: string,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  return (req, socket, head) => {
    if (!isClientAuthorized(req, clientToken)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    if (extractPath(req) !== WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit("connection", client, req);
    });
  };
}

function closeClients(wss: WebSocketServer): void {
  for (const client of wss.clients) {
    client.close(WS_GOING_AWAY_CODE);
    setTimeout(() => client.terminate(), WS_CLIENT_CLOSE_GRACE_MS).unref();
  }
}

async function closeWss(wss: WebSocketServer): Promise<void> {
  const closed = new Promise<void>((resolveClose) => {
    wss.close(() => resolveClose());
  });
  closeClients(wss);
  await closed;
}

interface ServicesHolder {
  current: SidecarServices | null;
}

function services(holder: ServicesHolder): SidecarServices {
  if (holder.current === null) throw new Error("sidecar services not ready");
  return holder.current;
}

function buildPermissionBus(
  options: AttachWsServerOptions,
  holder: ServicesHolder,
): PermissionBus {
  if (options.permissionBus !== undefined) return options.permissionBus;
  return createPermissionBus({
    getPolicy: () => permissionPolicy(services(holder)),
    onPromptChat: (request) => onPermissionPrompt(services(holder), request),
    onDecided: (record) => onPermissionDecided(services(holder), record),
    onRulesChanged: (conversationId) =>
      onRulesChanged(services(holder), conversationId),
    onDenyAll: (conversationId) =>
      interruptConversation(services(holder), conversationId),
  });
}

function buildQuestionBus(holder: ServicesHolder): QuestionBus {
  return createQuestionBus({
    onPromptChat: (question) => onQuestionPrompt(services(holder), question),
    onAnswered: (question, reply) =>
      onQuestionAnswered(services(holder), question, reply),
    onExpired: (question) => onQuestionExpired(services(holder), question),
    onSettled: () => broadcastConversationList(services(holder)),
  });
}

/** Change sets off: no git, nothing recorded. */
function createDisabledCheckpoints(): Checkpoints {
  return createCheckpoints({
    git: createShadowGit({ gitDir: "", workTree: "", extraExcludes: [] }),
    store: createChangeSetStore(""),
  });
}

function onModeChanged(holder: ServicesHolder, conversationId: string): void {
  const current = services(holder);
  current.runner.refreshSession(conversationId);
  sendConversationMode(current, conversationId);
  broadcastConversationList(current);
}

interface ServiceParts {
  options: AttachWsServerOptions;
  holder: ServicesHolder;
  chatSocketRegistry: ChatSocketRegistry;
  settingsStore: SettingsStore;
  editTracker: EditTracker;
}

function buildServices(parts: ServiceParts): RoutingConfig {
  const { options, holder, chatSocketRegistry, settingsStore } = parts;
  const createMcpDeps = buildMcpDepsFactory(
    options.mcpDeps,
    holder,
    createHostCommandRouter(options.hostSocketRegistry, chatSocketRegistry),
  );
  const builderServers = createMcpServerCache(createMcpDeps);
  const analystServers = createMcpServerCache(
    createMcpDeps,
    createAnalystMcpServer,
  );
  return {
    hostProjectRoot: options.hostProjectRoot,
    conversationStore: options.conversationStore,
    settingsStore,
    createMcpServer: (conversationId) => builderServers.get(conversationId),
    createAnalystMcpServer: (conversationId) =>
      analystServers.get(conversationId),
    forgetMcpServers: (conversationId) => {
      builderServers.forget(conversationId);
      analystServers.forget(conversationId);
    },
    isDevelopment: options.isDevelopment,
    questionBus: buildQuestionBus(holder),
    editTracker: parts.editTracker,
    logsClient: options.mcpDeps.logsClient,
    moduleRoots: options.moduleRoots ?? [],
    hostState: options.hostState,
    hostSocketRegistry: options.hostSocketRegistry,
    chatSocketRegistry,
    permissionBus: buildPermissionBus(options, holder),
    navigationCompleter: options.navigationCompleter,
    idleController: options.idleController ?? NOOP_IDLE_CONTROLLER,
    runner: buildRunner(options, settingsStore.get(), createMcpDeps, holder),
    liveTurns: createLiveTurnStore(),
    pendingQueue: createPendingQueueStore(),
    conversationModes: createConversationModes({
      conversationStore: options.conversationStore,
      settingsStore,
      defaultAssistant: options.isDevelopment ? "builder" : "analyst",
      onChanged: (conversationId) => onModeChanged(holder, conversationId),
    }),
    checkpoints: options.checkpoints ?? createDisabledCheckpoints(),
    callAudit: createCallAudit(),
    callLedger: createCallLedger(),
    turns: createTurnRegistry(),
    askers: new Map(),
    turnActors: new Map(),
    socketActors: new WeakMap(),
    liveActors: new Set(),
  };
}

/**
 * When a settings applier is supplied it is pointed at this connection's
 * services, so the HTTP Settings page applies changes through the same path as
 * the chat's socket.
 */
export function attachWsServer(
  httpServer: Server,
  options: AttachWsServerOptions,
): AttachWsServerResult {
  const holder: ServicesHolder = { current: null };
  const config = buildServices({
    options,
    holder,
    chatSocketRegistry:
      options.chatSocketRegistry ?? createChatSocketRegistry(),
    settingsStore: options.settingsStore ?? NOOP_SETTINGS_STORE,
    editTracker: createEditTracker(),
  });
  holder.current = config;
  if (options.bridge !== undefined) options.bridge.services = config;
  if (options.settingsApplier) {
    options.settingsApplier.apply = (next) => applySettings(config, next);
  }
  const wss = buildWss(config);
  const onUpgrade = makeUpgradeHandler(wss, options.clientToken);
  httpServer.on("upgrade", onUpgrade);
  return {
    close: async () => {
      httpServer.removeListener("upgrade", onUpgrade);
      await config.runner.dispose(TURN_RESTARTED_REASON);
      await closeWss(wss);
    },
  };
}
