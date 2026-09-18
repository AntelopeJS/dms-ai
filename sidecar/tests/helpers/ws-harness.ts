import { mkdtemp, rm } from "node:fs/promises";
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
import { effectiveProvider } from "../../src/providers/availability.js";
import type { CodexRuntimeDeps } from "../../src/providers/codex/provider.js";
import { createHostSocketRegistry } from "../../src/server/host-socket-registry.js";
import { createHttpServer } from "../../src/server/http.js";
import type { IframeSocketRegistry } from "../../src/server/iframe-socket-registry.js";
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
const STATE_FILE = "state.json";
const ARBITRARY_PORT = 0;
const WS_HOST = "127.0.0.1";
export const WS_PATH_IFRAME = "/ws/iframe";
export const HOST_ROOT = "/tmp";
const MOCK_API_KEY = "sk-mock";

export interface HarnessOptions {
  provider: ProviderName;
  settings?: Partial<AppSettings>;
  permissionBus?: PermissionBus;
  iframeSocketRegistry?: IframeSocketRegistry;
  moduleRoots?: string[];
  skillDirs?: SkillSource[];
}

export interface WsHarness {
  port: number;
  tmpDir: string;
  conversationStore: ConversationStore;
  settingsStore: SettingsStore;
  close: () => Promise<void>;
}

function buildMcpDeps(
  hostState: ReturnType<typeof createHostState>,
  sendToHost: AiMcpServerStaticDeps["sendToHost"],
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
    sendToHost,
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

function buildCodexRuntime(
  stateDir: string,
  registry: McpHttpRegistry,
  port: number,
): CodexRuntimeDeps {
  return {
    stateDir,
    mcpHttpRegistry: registry,
    getMcpUrl: () => `http://${WS_HOST}:${port}/mcp`,
    getApiKey: () => MOCK_API_KEY,
  };
}

/**
 * The full connection stack — HTTP server, WS endpoints, runner — wired to one
 * provider. Both providers go through the same code path from here on, so a
 * test written once runs against either.
 */
// A provider whose mock is not set up degrades to the default one, which would
// quietly run the test against the wrong backend — and, for Claude, against the
// real SDK. Fail loudly instead.
function assertProviderReachable(provider: ProviderName): void {
  const effective = effectiveProvider(provider);
  if (effective === provider) return;
  throw new Error(
    `harness asked for ${provider} but the sidecar would run ${effective}`,
  );
}

export async function startWsHarness(
  options: HarnessOptions,
): Promise<WsHarness> {
  assertProviderReachable(options.provider);
  const tmpDir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
  const conversationStore = createConversationStore({
    store: createStore({ filePath: join(tmpDir, STATE_FILE) }),
  });
  await conversationStore.loadFromDisk();
  const mcpHttpRegistry = createMcpHttpRegistry();
  const { server, port } = await createHttpServer({
    clientToken: CLIENT_TOKEN,
    chatboxDistDir: process.cwd(),
    port: ARBITRARY_PORT,
    mcpHttpRegistry,
  });
  const hostState = createHostState();
  const hostSocketRegistry = createHostSocketRegistry();
  const navigationCompleter = createNavigationCompleter();
  const settingsStore = buildSettingsStore({
    ...DEFAULT_SETTINGS,
    provider: options.provider,
    ...options.settings,
  });
  const ws = attachWsServer(server, {
    clientToken: CLIENT_TOKEN,
    hostProjectRoot: HOST_ROOT,
    moduleRoots: options.moduleRoots,
    skillDirs: options.skillDirs,
    conversationStore,
    settingsStore,
    mcpDeps: buildMcpDeps(
      hostState,
      hostSocketRegistry.send,
      navigationCompleter,
    ),
    codexRuntime: buildCodexRuntime(
      join(tmpDir, ".state"),
      mcpHttpRegistry,
      port,
    ),
    hostState,
    hostSocketRegistry,
    navigationCompleter,
    permissionBus: options.permissionBus,
    iframeSocketRegistry: options.iframeSocketRegistry,
  });
  return {
    port,
    tmpDir,
    conversationStore,
    settingsStore,
    close: async () => {
      await ws.close();
      await mcpHttpRegistry.dispose();
      await conversationStore.flush();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}

export function iframeUrl(port: number): string {
  return `ws://${WS_HOST}:${port}${WS_PATH_IFRAME}`;
}

export function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((done, fail) => {
    socket.once("open", () => done());
    socket.once("error", fail);
  });
}

export async function openIframe(port: number): Promise<WebSocket> {
  const socket = new WebSocket(iframeUrl(port), `dms-ai.${CLIENT_TOKEN}`);
  await waitForOpen(socket);
  return socket;
}

export interface WireMessage {
  type: string;
  [key: string]: unknown;
}

export function sendHello(socket: WebSocket, conversationId: string): void {
  socket.send(
    JSON.stringify({ type: "hello", role: "iframe", conversationId }),
  );
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
): void {
  socket.send(
    JSON.stringify({
      type: "permission_response",
      conversationId: msg.conversationId,
      requestId: msg.requestId,
      decision,
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

// Deliberately without `provider`: that is how the chatbox changes a behaviour
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
