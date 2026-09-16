import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createPermissionBus } from "../../src/agent/permission-bus.js";
import { createHostSocketRegistry } from "../../src/server/host-socket-registry.js";
import { createHttpServer } from "../../src/server/http.js";
import { createIframeSocketRegistry } from "../../src/server/iframe-socket-registry.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";
import { attachWsServer } from "../../src/server/ws.js";
import { createConversationStore } from "../../src/state/conversations.js";
import { createHostState } from "../../src/state/host-state.js";
import { createStore } from "../../src/state/store.js";
import { rawDataToText } from "../../src/server/raw-data.js";

const TMP_PREFIX = "dms-ai-perm-resume-";
const STATE_FILE_NAME_TEST = "state.json";
const ARBITRARY_PORT = 0;
const CLIENT_TOKEN = "permission-test-credential";
const TEST_HOST_ROOT = "/tmp";
const WS_HOST = "127.0.0.1";
const WS_PATH_IFRAME = "/ws/iframe";
const HELLO_ROLE_IFRAME = "iframe";
const TEST_CONVERSATION_ID = "conv-resume-1";
const TEST_USER_CONTENT = "hi";
const PENDING_TOOL_NAME = "Bash";
const PENDING_TOOL_ARGS = { command: "echo hi" };
const COLLECT_TIMEOUT_MS = 2_000;
const EVENT_TYPE_SNAPSHOT = "conversation_snapshot";
const EVENT_TYPE_PERMISSION_REQUEST = "permission_request";

interface ServerHandle {
  port: number;
  tmpDir: string;
  close: () => Promise<void>;
  requestPermission: (
    conversationId: string,
    toolName: string,
    args: unknown,
  ) => void;
}

async function startTestServer(): Promise<ServerHandle> {
  const tmpDir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
  const store = createStore({ filePath: join(tmpDir, STATE_FILE_NAME_TEST) });
  const conversationStore = createConversationStore({ store });
  await conversationStore.loadFromDisk();
  const { server, port } = await createHttpServer({
    clientToken: CLIENT_TOKEN,
    chatboxDistDir: process.cwd(),
    port: ARBITRARY_PORT,
  });
  const hostState = createHostState();
  const hostSocketRegistry = createHostSocketRegistry();
  const iframeSocketRegistry = createIframeSocketRegistry();
  const permissionBus = createPermissionBus({
    onPromptIframe: () => {},
  });
  const navigationCompleter = createNavigationCompleter();
  const mcpDeps = {
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
    hostProjectRoot: TEST_HOST_ROOT,
    moduleRoots: [],
    logsClient: { getLogs: async () => [] },
    builderClient: { call: async () => undefined },
    builderEnabled: false,
    sendToHost: hostSocketRegistry.send,
    navigationCompleter,
  };
  const ws = attachWsServer(server, {
    clientToken: CLIENT_TOKEN,
    hostProjectRoot: TEST_HOST_ROOT,
    conversationStore,
    mcpDeps,
    hostState,
    hostSocketRegistry,
    iframeSocketRegistry,
    permissionBus,
    navigationCompleter,
  });
  conversationStore.appendMessage(TEST_CONVERSATION_ID, {
    role: "user",
    content: TEST_USER_CONTENT,
    timestampMs: Date.now(),
  });
  return {
    port,
    tmpDir,
    requestPermission: (conversationId, toolName, args) => {
      void permissionBus.requestPermission({ conversationId, toolName, args });
    },
    close: async () => {
      await ws.close();
      await conversationStore.flush();
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}

function buildIframeUrl(port: number): string {
  return `ws://${WS_HOST}:${port}${WS_PATH_IFRAME}`;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolveOpen, rejectOpen) => {
    socket.once("open", () => resolveOpen());
    socket.once("error", rejectOpen);
  });
}

interface CollectedMessage {
  type: string;
  [key: string]: unknown;
}

function collectUntilTypes(
  socket: WebSocket,
  expectedTypes: readonly string[],
  timeoutMs: number,
): Promise<CollectedMessage[]> {
  return new Promise((resolveCollect, rejectCollect) => {
    const events: CollectedMessage[] = [];
    const remaining = new Set(expectedTypes);
    const timer = setTimeout(() => {
      rejectCollect(
        new Error(
          `timed out waiting for: ${[...remaining].join(", ")} (got: ${events
            .map((e) => e.type)
            .join(", ")})`,
        ),
      );
    }, timeoutMs);
    socket.on("message", (data) => {
      const raw = rawDataToText(data);
      const parsed = JSON.parse(raw) as CollectedMessage;
      events.push(parsed);
      remaining.delete(parsed.type);
      if (remaining.size === 0) {
        clearTimeout(timer);
        resolveCollect(events);
      }
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      rejectCollect(err);
    });
  });
}

function sendHello(socket: WebSocket): void {
  socket.send(
    JSON.stringify({
      type: "hello",
      role: HELLO_ROLE_IFRAME,
      conversationId: TEST_CONVERSATION_ID,
    }),
  );
}

describe("iframe reconnect resumes pending permission", () => {
  let handle: ServerHandle;

  beforeEach(async () => {
    handle = await startTestServer();
  });

  afterEach(async () => {
    await handle.close();
  });

  it("replays conversation_snapshot and pending permission_request on hello", async () => {
    handle.requestPermission(
      TEST_CONVERSATION_ID,
      PENDING_TOOL_NAME,
      PENDING_TOOL_ARGS,
    );
    const client = new WebSocket(
      buildIframeUrl(handle.port),
      `dms-ai.${CLIENT_TOKEN}`,
    );
    await waitForOpen(client);
    const collected = collectUntilTypes(
      client,
      [EVENT_TYPE_SNAPSHOT, EVENT_TYPE_PERMISSION_REQUEST],
      COLLECT_TIMEOUT_MS,
    );
    sendHello(client);
    const events = await collected;
    client.close();
    const snapshot = events.find((e) => e.type === EVENT_TYPE_SNAPSHOT);
    const permission = events.find(
      (e) => e.type === EVENT_TYPE_PERMISSION_REQUEST,
    );
    expect(snapshot).toBeDefined();
    expect(permission).toBeDefined();
    expect(permission?.conversationId).toBe(TEST_CONVERSATION_ID);
    expect(permission?.toolName).toBe(PENDING_TOOL_NAME);
  });
});
