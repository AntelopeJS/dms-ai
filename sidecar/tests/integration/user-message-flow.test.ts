import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createHostSocketRegistry } from "../../src/server/host-socket-registry.js";
import { createHttpServer } from "../../src/server/http.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";
import { attachWsServer } from "../../src/server/ws.js";
import { createConversationStore } from "../../src/state/conversations.js";
import { createHostState } from "../../src/state/host-state.js";
import { createStore } from "../../src/state/store.js";
import { rawDataToText } from "../../src/server/raw-data.js";

const SCRIPT_PATH = resolve(
  __dirname,
  "../fixtures/mock-claude/scripts/list-files.json",
);

const MOCK_FLAG_VALUE = "1";
const TEST_CONVERSATION_ID = "conv-test-1";
const TEST_HOST_ROOT = "/tmp";
const ARBITRARY_PORT = 0;
const CLIENT_TOKEN = "user-message-test-credential";
const HELLO_ROLE_IFRAME = "iframe";
const WS_PATH_IFRAME = "/ws/iframe";
const WS_HOST = "127.0.0.1";
const RUN_TIMEOUT_MS = 10_000;
const TERMINAL_EVENT_TYPES = ["run_done", "run_error"] as const;

interface ServerHandle {
  port: number;
  tmpDir: string;
  close: () => Promise<void>;
}

const TMP_PREFIX = "dms-ai-flow-";
const STATE_FILE_NAME_TEST = "state.json";

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
    navigationCompleter,
  });
  return {
    port,
    tmpDir,
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

function isTerminal(type: string): boolean {
  return (TERMINAL_EVENT_TYPES as readonly string[]).includes(type);
}

function autoApprovePermission(socket: WebSocket, msg: CollectedMessage): void {
  if (msg.type !== "permission_request") return;
  socket.send(
    JSON.stringify({
      type: "permission_response",
      conversationId: msg.conversationId,
      requestId: msg.requestId,
      decision: "allow_once",
    }),
  );
}

function collectUntilTerminal(
  socket: WebSocket,
  timeoutMs: number,
): Promise<CollectedMessage[]> {
  return new Promise((resolveCollect, rejectCollect) => {
    const events: CollectedMessage[] = [];
    const timer = setTimeout(() => {
      rejectCollect(new Error("timed out waiting for run_done"));
    }, timeoutMs);
    socket.on("message", (data) => {
      const raw = rawDataToText(data);
      const parsed = JSON.parse(raw) as CollectedMessage;
      events.push(parsed);
      autoApprovePermission(socket, parsed);
      if (isTerminal(parsed.type)) {
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

function sendUserMessage(socket: WebSocket, content: string): void {
  socket.send(
    JSON.stringify({
      type: "user_message",
      conversationId: TEST_CONVERSATION_ID,
      content,
    }),
  );
}

describe("user_message → ClaudeRunner WS flow", () => {
  let handle: ServerHandle;

  beforeEach(async () => {
    process.env.MOCK_CLAUDE = MOCK_FLAG_VALUE;
    process.env.MOCK_CLAUDE_SCRIPT = SCRIPT_PATH;
    handle = await startTestServer();
  });

  afterEach(async () => {
    delete process.env.MOCK_CLAUDE;
    delete process.env.MOCK_CLAUDE_SCRIPT;
    await handle.close();
  });

  it("forwards runner events as wire events ending in run_done", async () => {
    const client = new WebSocket(
      buildIframeUrl(handle.port),
      `dms-ai.${CLIENT_TOKEN}`,
    );
    await waitForOpen(client);
    const collected = collectUntilTerminal(client, RUN_TIMEOUT_MS);
    sendHello(client);
    sendUserMessage(client, "list");
    const events = await collected;
    client.close();
    const types = events.map((e) => e.type);
    expect(types).toContain("assistant_message_chunk");
    expect(types[types.length - 1]).toBe("run_done");
    const lastEvent = events[events.length - 1];
    expect(lastEvent?.conversationId).toBe(TEST_CONVERSATION_ID);
  });
});
