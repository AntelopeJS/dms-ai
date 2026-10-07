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
import { createQuestionBus, type QuestionBus } from "../agent/question-bus.js";
import {
  type AgentRunner,
  type ConversationSettingsResolver,
  createAgentRunner,
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
import { DEFAULT_SETTINGS } from "../constants/settings.js";
import {
  WS_CLIENT_CLOSE_GRACE_MS,
  WS_GOING_AWAY_CODE,
  WS_LOG_PREFIX,
  WS_PATH,
} from "../constants/ws.js";
import { createAiMcpServer } from "../mcp/sdk-binding.js";
import type {
  AiMcpServer,
  AiMcpServerDeps,
  AiMcpServerStaticDeps,
} from "../mcp/types.js";
import { PROVIDER_MODULES } from "../providers/registry.js";
import type {
  ProviderHostRuntime,
  ProviderRuntime,
} from "../providers/types.js";
import type { SkillSource } from "../skills/types.js";
import { createChangeSetStore } from "../state/change-sets.js";
import type { ConversationStore } from "../state/conversations.js";
import type { HostState } from "../state/host-state.js";
import type { SettingsStore } from "../state/settings-store.js";
import type { AppSettings } from "../state/settings-types.js";
import { PROVIDER_NAMES, type ProviderName } from "../state/types.js";
import {
  broadcastConversationList,
  emitNotice,
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
import { createTurnRegistry } from "./turn-registry.js";

export interface AttachWsServerOptions {
  clientToken: string;
  hostProjectRoot: string;
  moduleRoots?: string[];
  skillDirs?: SkillSource[];
  conversationStore: ConversationStore;
  settingsStore?: SettingsStore;
  mcpDeps: AiMcpServerStaticDeps;
  // What the sidecar's own runtime offers every provider. Neutral: the backends
  // are reached through the registry, never by name from here.
  providerRuntime: ProviderHostRuntime;
  hostState: HostState;
  hostSocketRegistry: HostSocketRegistry;
  navigationCompleter: NavigationCompleter;
  idleController?: IdleShutdownController;
  permissionBus?: PermissionBus;
  chatSocketRegistry?: ChatSocketRegistry;
  settingsApplier?: SettingsApplier;
  // Started by the caller; absent, change sets are off.
  checkpoints?: Checkpoints;
  // Filled with the live services, for the HTTP routes that read them.
  bridge?: SidecarBridge;
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
): AgentProviderOptions {
  return {
    settings,
    moduleRoots: options.moduleRoots ?? [],
    skillDirs: options.skillDirs ?? [],
  };
}

// One factory per registered provider, all built the same way: the registry is
// the only thing here that knows which backends exist.
function buildRunnerFactories(
  options: AttachWsServerOptions,
  runtime: ProviderRuntime,
  resolveSettings: ConversationSettingsResolver,
): Record<ProviderName, ProviderRunnerFactory> {
  const factories = PROVIDER_NAMES.map((name) => [
    name,
    (settings: AppSettings) =>
      createAgentRunner(
        PROVIDER_MODULES[name].create(
          buildBaseOptions(options, settings),
          runtime,
        ),
        { settings, resolveSettings },
      ),
  ]);
  return Object.fromEntries(factories) as Record<
    ProviderName,
    ProviderRunnerFactory
  >;
}

function buildRunner(
  options: AttachWsServerOptions,
  settings: AppSettings,
  createMcpDeps: (conversationId: string) => AiMcpServerDeps,
  holder: ServicesHolder,
): AgentRunner {
  return createSwitchingRunner(
    buildRunnerFactories(
      options,
      { ...options.providerRuntime, createMcpDeps },
      (conversationId, global) =>
        services(holder).conversationModes.settingsFor(conversationId, global),
    ),
    settings,
  );
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

// Tools are bound per conversation so AskUser can reach the right chat: no
// MCP transport carries our conversationId down to a tool handler, so it is
// closed over here instead. Shared by both bindings.
function buildMcpDepsFactory(
  staticDeps: AiMcpServerStaticDeps,
  holder: ServicesHolder,
  hostCommandsOf: (conversationId: string) => HostCommandSender,
): (conversationId: string) => AiMcpServerDeps {
  return (conversationId) => ({
    ...staticDeps,
    conversationId,
    sendToHost: hostCommandsOf(conversationId),
    requestQuestion: (req) => services(holder).questionBus.requestQuestion(req),
    getLastEditedFile: () =>
      services(holder).editTracker.getLastEditedFile(conversationId),
    gateBuilderOp: (toolName, args) =>
      buildBuilderGate(services(holder), conversationId)(toolName, args),
  });
}

// Memoized so a conversation reuses one server instance across its turns.
function buildMcpServerFactory(
  createMcpDeps: (conversationId: string) => AiMcpServerDeps,
): (conversationId: string) => AiMcpServer {
  const byConversation = new Map<string, AiMcpServer>();
  return (conversationId) => {
    const existing = byConversation.get(conversationId);
    if (existing !== undefined) return existing;
    const server = createAiMcpServer(createMcpDeps(conversationId));
    byConversation.set(conversationId, server);
    return server;
  };
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
    getPolicy: (conversationId) =>
      permissionPolicy(services(holder), conversationId),
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
export function createDisabledCheckpoints(): Checkpoints {
  return createCheckpoints({
    git: createShadowGit({ gitDir: "", workTree: "", extraExcludes: [] }),
    store: createChangeSetStore(""),
  });
}

function onModeChanged(
  holder: ServicesHolder,
  conversationId: string,
  hasFullAutoEnded: boolean,
): void {
  const current = services(holder);
  current.runner.refreshSession(conversationId);
  if (hasFullAutoEnded) {
    emitNoticeSafely(current, conversationId);
  }
  sendConversationMode(current, conversationId);
  broadcastConversationList(current);
}

function emitNoticeSafely(current: SidecarServices, conversationId: string) {
  if (current.conversationStore.get(conversationId) === null) return;
  emitNotice(current, conversationId, {
    kind: "full_auto_ended",
    timestampMs: Date.now(),
  });
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
  return {
    hostProjectRoot: options.hostProjectRoot,
    conversationStore: options.conversationStore,
    settingsStore,
    createMcpServer: buildMcpServerFactory(createMcpDeps),
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
      onChanged: (conversationId, hasEnded) =>
        onModeChanged(holder, conversationId, hasEnded),
    }),
    checkpoints: options.checkpoints ?? createDisabledCheckpoints(),
    callAudit: createCallAudit(),
    callLedger: createCallLedger(),
    turns: createTurnRegistry(),
    askers: new Map(),
  };
}

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
  // Let the HTTP Settings page apply changes through the same path as the
  // chat's socket by pointing the shared applier at this connection's services.
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
