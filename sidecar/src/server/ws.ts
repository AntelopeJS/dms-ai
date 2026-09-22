import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { createEditTracker, type EditTracker } from "../agent/edit-tracker.js";
import {
  createPermissionBus,
  type PendingRequest,
  type PermissionBus,
} from "../agent/permission-bus.js";
import type { AgentProviderOptions } from "../agent/provider.js";
import {
  createQuestionBus,
  type PendingQuestion,
  type QuestionBus,
} from "../agent/question-bus.js";
import { type AgentRunner, createAgentRunner } from "../agent/runner.js";
import {
  createSwitchingRunner,
  type ProviderRunnerFactory,
} from "../agent/switching-runner.js";
import { buildToolSummary } from "../agent/tool-summary.js";
import { WS_MAX_PAYLOAD_BYTES } from "../constants/attachments.js";
import { DEFAULT_SETTINGS } from "../constants/settings.js";
import { WS_LOG_PREFIX, WS_PATHS } from "../constants/ws.js";
import { createAiMcpServer } from "../mcp/sdk-binding.js";
import type {
  AiMcpServer,
  AiMcpServerDeps,
  AiMcpServerStaticDeps,
} from "../mcp/types.js";
import {
  type AskQuestionEventType,
  EVENT_TYPES,
  type PermissionRequestEventType,
} from "../protocol/events.js";
import { PROVIDER_MODULES } from "../providers/registry.js";
import type {
  ProviderHostRuntime,
  ProviderRuntime,
} from "../providers/types.js";
import type { SkillSource } from "../skills/types.js";
import type { ConversationStore } from "../state/conversations.js";
import type { HostState } from "../state/host-state.js";
import type { SettingsStore } from "../state/settings-store.js";
import type { AppSettings } from "../state/settings-types.js";
import { PROVIDER_NAMES, type ProviderName } from "../state/types.js";
import { isClientAuthorized } from "./client-auth.js";
import type { HostSocketRegistry } from "./host-socket-registry.js";
import type { SettingsApplier } from "./http.js";
import type { IdleShutdownController } from "./idle-shutdown.js";
import {
  createIframeSocketRegistry,
  type IframeSocketRegistry,
} from "./iframe-socket-registry.js";
import { createLiveTurnStore } from "./live-turns.js";
import type { NavigationCompleter } from "./navigation-completer.js";
import { createPendingQueueStore } from "./pending-queue.js";
import { rawDataToText } from "./raw-data.js";
import {
  applySettings,
  buildConnectionContext,
  dispatchMessage,
  type RoutingConfig,
} from "./routing.js";

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
  iframeSocketRegistry?: IframeSocketRegistry;
  settingsApplier?: SettingsApplier;
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
): Record<ProviderName, ProviderRunnerFactory> {
  const factories = PROVIDER_NAMES.map((name) => [
    name,
    (settings: AppSettings) =>
      createAgentRunner(
        PROVIDER_MODULES[name].create(
          buildBaseOptions(options, settings),
          runtime,
        ),
        { settings },
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
): AgentRunner {
  return createSwitchingRunner(
    buildRunnerFactories(options, {
      ...options.providerRuntime,
      createMcpDeps,
    }),
    settings,
  );
}

function bindConnection(
  socket: WebSocket,
  path: string,
  config: RoutingConfig,
): void {
  const ctx = buildConnectionContext(socket, path, config);
  config.idleController.increment();
  socket.on("message", (data) => {
    const raw = rawDataToText(data);
    dispatchMessage(socket, raw, ctx);
  });
  socket.on("error", (err) => {
    console.warn(`${WS_LOG_PREFIX} socket error on ${path}: ${err.message}`);
  });
  socket.on("close", (code) => {
    config.hostSocketRegistry.clear(socket);
    config.iframeSocketRegistry.clear(socket);
    config.idleController.decrement();
    console.log(`${WS_LOG_PREFIX} close path=${path} code=${code}`);
  });
}

function buildPermissionRequestEvent(
  event: PendingRequest,
): PermissionRequestEventType {
  return {
    type: EVENT_TYPES.PERMISSION_REQUEST,
    conversationId: event.conversationId,
    requestId: event.requestId,
    toolName: event.toolName,
    args: event.args,
    summary: buildToolSummary(event.toolName, event.args),
  };
}

function buildSharedPermissionBus(
  iframeSocketRegistry: IframeSocketRegistry,
): PermissionBus {
  return createPermissionBus({
    onPromptIframe: (event) => {
      iframeSocketRegistry.send(
        event.conversationId,
        buildPermissionRequestEvent(event),
      );
    },
  });
}

function buildAskQuestionEvent(event: PendingQuestion): AskQuestionEventType {
  return {
    type: EVENT_TYPES.ASK_QUESTION,
    conversationId: event.conversationId,
    requestId: event.requestId,
    questions: event.questions,
  };
}

function buildSharedQuestionBus(
  iframeSocketRegistry: IframeSocketRegistry,
): QuestionBus {
  return createQuestionBus({
    onPromptIframe: (event) => {
      iframeSocketRegistry.send(
        event.conversationId,
        buildAskQuestionEvent(event),
      );
    },
  });
}

// Tools are bound per conversation so AskUser can reach the right iframe: no
// MCP transport carries our conversationId down to a tool handler, so it is
// closed over here instead. Shared by both bindings.
function buildMcpDepsFactory(
  staticDeps: AiMcpServerStaticDeps,
  questionBus: QuestionBus,
  editTracker: EditTracker,
): (conversationId: string) => AiMcpServerDeps {
  return (conversationId) => ({
    ...staticDeps,
    conversationId,
    requestQuestion: questionBus.requestQuestion,
    getLastEditedFile: () => editTracker.getLastEditedFile(conversationId),
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

function buildWss(path: string, config: RoutingConfig): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: WS_MAX_PAYLOAD_BYTES,
  });
  wss.on("connection", (socket) => {
    bindConnection(socket, path, config);
  });
  return wss;
}

function extractPath(req: IncomingMessage): string {
  const url = req.url ?? "/";
  return url.split("?")[0] ?? "/";
}

function makeUpgradeHandler(
  wssByPath: Record<string, WebSocketServer>,
  clientToken: string,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  return (req, socket, head) => {
    if (!isClientAuthorized(req, clientToken)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const path = extractPath(req);
    const wss = wssByPath[path];
    if (wss === undefined) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit("connection", client, req);
    });
  };
}

async function closeWss(wss: WebSocketServer): Promise<void> {
  await new Promise<void>((resolveClose) => {
    wss.close(() => resolveClose());
  });
}

export function attachWsServer(
  httpServer: Server,
  options: AttachWsServerOptions,
): AttachWsServerResult {
  const iframeSocketRegistry =
    options.iframeSocketRegistry ?? createIframeSocketRegistry();
  const permissionBus =
    options.permissionBus ?? buildSharedPermissionBus(iframeSocketRegistry);
  const questionBus = buildSharedQuestionBus(iframeSocketRegistry);
  const editTracker = createEditTracker();
  const createMcpDeps = buildMcpDepsFactory(
    options.mcpDeps,
    questionBus,
    editTracker,
  );
  const createMcpServer = buildMcpServerFactory(createMcpDeps);
  const settingsStore = options.settingsStore ?? NOOP_SETTINGS_STORE;
  const initialSettings = settingsStore.get();
  permissionBus.setAutoApprove(initialSettings.mode === "auto");
  const config: RoutingConfig = {
    hostProjectRoot: options.hostProjectRoot,
    conversationStore: options.conversationStore,
    settingsStore,
    createMcpServer,
    questionBus,
    editTracker,
    logsClient: options.mcpDeps.logsClient,
    moduleRoots: options.moduleRoots ?? [],
    hostState: options.hostState,
    hostSocketRegistry: options.hostSocketRegistry,
    iframeSocketRegistry,
    permissionBus,
    navigationCompleter: options.navigationCompleter,
    idleController: options.idleController ?? NOOP_IDLE_CONTROLLER,
    runner: buildRunner(options, initialSettings, createMcpDeps),
    liveTurns: createLiveTurnStore(),
    pendingQueue: createPendingQueueStore(),
  };
  // Let the HTTP Settings page apply changes through the same path as the WS
  // chatbox by pointing the shared applier at this connection's services.
  if (options.settingsApplier) {
    options.settingsApplier.apply = (next) => applySettings(config, next);
  }
  const wssIframe = buildWss(WS_PATHS.IFRAME, config);
  const wssHost = buildWss(WS_PATHS.HOST, config);
  const wssByPath: Record<string, WebSocketServer> = {
    [WS_PATHS.IFRAME]: wssIframe,
    [WS_PATHS.HOST]: wssHost,
  };
  const onUpgrade = makeUpgradeHandler(wssByPath, options.clientToken);
  httpServer.on("upgrade", onUpgrade);
  return {
    close: async () => {
      httpServer.removeListener("upgrade", onUpgrade);
      config.runner.dispose();
      await closeWss(wssIframe);
      await closeWss(wssHost);
    },
  };
}
