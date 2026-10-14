import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { rawDataToText } from "../../src/server/raw-data.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { PermissionBus } from "../../src/agent/permission-bus.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import {
  createMcpHttpRegistry,
  type McpHttpRegistry,
} from "../../src/mcp/http-binding.js";
import type { AiMcpServerStaticDeps } from "../../src/mcp/types.js";
import { isProviderAvailable } from "../../src/providers/registry.js";
import type { ProviderHostRuntime } from "../../src/providers/types.js";
import { createHostSocketRegistry } from "../../src/server/host-socket-registry.js";
import {
  checkpointExcludes,
  type Checkpoints,
  createCheckpoints,
} from "../../src/checkpoints/checkpoints.js";
import { createShadowGit } from "../../src/checkpoints/shadow-git.js";
import { createChangeSetStore } from "../../src/state/change-sets.js";
import {
  createHttpServer,
  type SettingsApplier,
  type SidecarBridge,
} from "../../src/server/http.js";
import type { ChatSocketRegistry } from "../../src/server/chat-socket-registry.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";
import { attachWsServer } from "../../src/server/ws.js";
import type { SkillSource } from "../../src/skills/types.js";
import {
  type ConversationStore,
  createConversationStore,
} from "../../src/state/conversations.js";
import { createHostState } from "../../src/state/host-state.js";
import type { SettingsStore } from "../../src/state/settings-store.js";
import type { AppSettings } from "../../src/state/settings-types.js";
import { createStore } from "../../src/state/store.js";
import type { ProviderName } from "../../src/state/types.js";

export const CLIENT_TOKEN = "ws-harness-test-credential";

const TMP_PREFIX = "dms-ai-harness-";
export const STATE_FILE = "state.json";
const ARBITRARY_PORT = 0;
const WS_HOST = "127.0.0.1";
const WS_PATH = "/ws";
export const HOST_ROOT = "/tmp";

export interface HarnessOptions {
  provider: ProviderName;
  // A fresh project directory under the harness's temp dir, with change sets
  // recorded in a shadow repository; the shared HOST_ROOT otherwise.
  withProject?: boolean;
  settings?: Partial<AppSettings>;
  permissionBus?: PermissionBus;
  chatSocketRegistry?: ChatSocketRegistry;
  moduleRoots?: string[];
  skillDirs?: SkillSource[];
}

export interface WsHarness {
  port: number;
  tmpDir: string;
  projectRoot: string;
  bridge: SidecarBridge;
  conversationStore: ConversationStore;
  settingsStore: SettingsStore;
  /** Stops the stack the way the sidecar's graceful shutdown does, files kept. */
  shutdown: () => Promise<void>;
  close: () => Promise<void>;
}

function buildMcpDeps(
  hostState: ReturnType<typeof createHostState>,
  navigationCompleter: ReturnType<typeof createNavigationCompleter>,
): AiMcpServerStaticDeps {
  return {
    getCurrentPage: () => hostState.getCurrentPage(),
    registry: {
      getRegistry: async () => [],
      getStaleSinceMs: () => null,
      invalidate: () => {},
    },
    scanner: {
      scan: async () => ({ importersByFile: new Map() }),
      invalidate: () => {},
    },
    hostProjectRoot: HOST_ROOT,
    moduleRoots: [],
    logsClient: { getLogs: async () => [] },
    builderClient: { call: async () => undefined },
    builderEnabled: false,
    navigationCompleter,
  };
}

// In-memory settings: the harness never writes them back to disk, and every
// test that cares about a value passes it in.
function buildSettingsStore(settings: AppSettings): SettingsStore {
  let current = settings;
  return {
    get: () => current,
    set: (next) => {
      current = next;
    },
    load: () => Promise.resolve(),
    flush: () => Promise.resolve(),
  };
}

// The API key is not passed in any more: a provider reads its own environment,
// exactly as it does in production. CODEX_FIXTURE.use() puts one there.
export function buildProviderRuntime(
  stateDir: string,
  registry: McpHttpRegistry,
  port: number,
): ProviderHostRuntime {
  return {
    stateDir,
    mcpHttpRegistry: registry,
    getMcpUrl: () => `http://${WS_HOST}:${port}/mcp`,
  };
}

/**
 * The full connection stack — HTTP server, WS endpoints, runner — wired to one
 * provider. Both providers go through the same code path from here on, so a
 * test written once runs against either.
 */
// A provider whose mock is not set up would fail every turn with an
// availability error, which reads as a broken test rather than a missing
// fixture. Say so here instead.
function assertProviderReachable(provider: ProviderName): void {
  if (isProviderAvailable(provider)) return;
  throw new Error(
    `harness asked for ${provider} but this install cannot drive it`,
  );
}

const PROJECT_DIR = "project";
const PROJECT_STATE_SEGMENTS = ["node_modules", ".cache", "dms-ai"];
const RETENTION_DAYS = 30;

async function startProjectCheckpoints(root: string): Promise<Checkpoints> {
  await mkdir(root, { recursive: true });
  const stateDir = join(root, ...PROJECT_STATE_SEGMENTS);
  const checkpoints = createCheckpoints({
    git: createShadowGit({
      gitDir: join(stateDir, "checkpoints.git"),
      workTree: root,
      extraExcludes: checkpointExcludes(stateDir, root),
    }),
    store: createChangeSetStore(join(stateDir, "change-sets.json")),
  });
  await checkpoints.start(RETENTION_DAYS);
  return checkpoints;
}

export async function startWsHarness(
  options: HarnessOptions,
): Promise<WsHarness> {
  assertProviderReachable(options.provider);
  const tmpDir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
  const projectRoot =
    options.withProject === true ? join(tmpDir, PROJECT_DIR) : HOST_ROOT;
  const checkpoints =
    options.withProject === true
      ? await startProjectCheckpoints(projectRoot)
      : undefined;
  const conversationStore = createConversationStore({
    store: createStore({ filePath: join(tmpDir, STATE_FILE) }),
  });
  await conversationStore.loadFromDisk();
  const mcpHttpRegistry = createMcpHttpRegistry();
  const settingsStore = buildSettingsStore({
    ...DEFAULT_SETTINGS,
    provider: options.provider,
    ...options.settings,
  });
  const bridge: SidecarBridge = {};
  const settingsApplier: SettingsApplier = { apply: settingsStore.set };
  const { server, port } = await createHttpServer({
    clientToken: CLIENT_TOKEN,
    port: ARBITRARY_PORT,
    mcpHttpRegistry,
    conversationStore,
    settingsStore,
    settingsApplier,
    bridge,
  });
  const hostState = createHostState();
  const hostSocketRegistry = createHostSocketRegistry();
  const navigationCompleter = createNavigationCompleter();
  const ws = attachWsServer(server, {
    clientToken: CLIENT_TOKEN,
    hostProjectRoot: projectRoot,
    checkpoints,
    bridge,
    settingsApplier,
    moduleRoots: options.moduleRoots,
    skillDirs: options.skillDirs,
    conversationStore,
    settingsStore,
    mcpDeps: buildMcpDeps(hostState, navigationCompleter),
    providerRuntime: buildProviderRuntime(
      join(tmpDir, ".state"),
      mcpHttpRegistry,
      port,
    ),
    hostState,
    hostSocketRegistry,
    navigationCompleter,
    permissionBus: options.permissionBus,
    chatSocketRegistry: options.chatSocketRegistry,
  });
  return {
    port,
    tmpDir,
    projectRoot,
    bridge,
    conversationStore,
    settingsStore,
    shutdown: async () => {
      await ws.close();
      await conversationStore.flush();
    },
    close: async () => {
      await ws.close();
      await mcpHttpRegistry.dispose();
      await conversationStore.flush();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}

export function socketUrl(port: number): string {
  return `ws://${WS_HOST}:${port}${WS_PATH}`;
}

/** Connects the way the DMS backend does: one socket, the client credential as a Bearer header. */
export function connectClient(port: number): WebSocket {
  return new WebSocket(socketUrl(port), {
    headers: { Authorization: `Bearer ${CLIENT_TOKEN}` },
  });
}

export function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((done, fail) => {
    socket.once("open", () => done());
    socket.once("error", fail);
  });
}

export async function openChat(port: number): Promise<WebSocket> {
  const socket = connectClient(port);
  await waitForOpen(socket);
  return socket;
}

export interface WireMessage {
  type: string;
  [key: string]: unknown;
}

export function sendHello(socket: WebSocket, conversationId: string): void {
  socket.send(JSON.stringify({ type: "hello", role: "chat", conversationId }));
}

export function sendUserMessage(
  socket: WebSocket,
  conversationId: string,
  content: string,
): void {
  socket.send(
    JSON.stringify({ type: "user_message", conversationId, content }),
  );
}

export function answerPermission(
  socket: WebSocket,
  msg: WireMessage,
  decision: string,
  rule?: unknown,
): void {
  socket.send(
    JSON.stringify({
      type: "permission_response",
      conversationId: msg.conversationId,
      requestId: msg.requestId,
      decision,
      rule,
    }),
  );
}

export interface CollectOptions {
  timeoutMs: number;
  until: (msg: WireMessage) => boolean;
  onMessage?: (msg: WireMessage, socket: WebSocket) => void;
}

export function collectUntil(
  socket: WebSocket,
  options: CollectOptions,
): Promise<WireMessage[]> {
  return new Promise((done, fail) => {
    const events: WireMessage[] = [];
    const timer = setTimeout(
      () => fail(new Error(`timed out after ${events.length} events`)),
      options.timeoutMs,
    );
    socket.on("message", (data) => {
      const raw = rawDataToText(data);
      const parsed = JSON.parse(raw) as WireMessage;
      events.push(parsed);
      options.onMessage?.(parsed, socket);
      if (!options.until(parsed)) return;
      clearTimeout(timer);
      done(events);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      fail(err);
    });
  });
}

const TERMINAL_EVENTS = ["run_done", "run_error"];

export function isTerminal(msg: WireMessage): boolean {
  return TERMINAL_EVENTS.includes(msg.type);
}

interface WireMessageWaiter {
  matches: (msg: WireMessage) => boolean;
  resolve: (msg: WireMessage) => void;
}

export interface WireCollector {
  events: WireMessage[];
  /** Resolves with the first matching event, past ones included. */
  next: (matches: (msg: WireMessage) => boolean) => Promise<WireMessage>;
}

export function createCollector(
  socket: WebSocket,
  timeoutMs: number,
): WireCollector {
  const events: WireMessage[] = [];
  const waiters: WireMessageWaiter[] = [];
  socket.on("message", (data) => {
    const raw = rawDataToText(data);
    const parsed = JSON.parse(raw) as WireMessage;
    events.push(parsed);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]?.matches(parsed) !== true) continue;
      waiters.splice(i, 1)[0]?.resolve(parsed);
    }
  });
  const next = (matches: (msg: WireMessage) => boolean): Promise<WireMessage> =>
    new Promise((done, fail) => {
      const seen = events.find(matches);
      if (seen !== undefined) {
        done(seen);
        return;
      }
      const timer = setTimeout(
        () => fail(new Error("timed out waiting for event")),
        timeoutMs,
      );
      waiters.push({
        matches,
        resolve: (msg) => {
          clearTimeout(timer);
          done(msg);
        },
      });
    });
  return { events, next };
}

// `object`, not a message type: several cases send a frame the protocol should
// reject, and not `unknown`, which would let `sendWire(socket, undefined)`
// compile.
// oxlint-disable-next-line anti-slop/no-object-parameters
export function sendWire(socket: WebSocket, msg: object): void {
  socket.send(JSON.stringify(msg));
}

// Deliberately without `provider`: that is how the chat changes a behaviour
// setting, and sending the default would switch the backend as a side effect.
export function sendSettings(
  socket: WebSocket,
  settings: Partial<Omit<AppSettings, "provider">>,
): void {
  const { provider: _provider, ...rest } = DEFAULT_SETTINGS;
  sendWire(socket, { type: "set_settings", ...rest, ...settings });
}

export function interruptTurn(socket: WebSocket, conversationId: string): void {
  sendWire(socket, { type: "interrupt_turn", conversationId });
}

export function sendUserMessageWithAttachment(
  socket: WebSocket,
  conversationId: string,
  content: string,
  attachment: { name: string; mimeType: string; size: number; data: string },
): void {
  sendWire(socket, {
    type: "user_message",
    conversationId,
    content,
    attachments: [attachment],
  });
}

/** Calls one of the sidecar's HTTP routes the way the DMS backend does. */
export async function callApi(
  port: number,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`http://${WS_HOST}:${port}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CLIENT_TOKEN}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}
