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
const CONV = "conv-drain-1";
const TEST_HOST_ROOT = "/tmp";
const ARBITRARY_PORT = 0;
const CLIENT_TOKEN = "queue-drain-test-credential";
const WS_HOST = "127.0.0.1";
const WS_PATH_IFRAME = "/ws/iframe";
const RUN_TIMEOUT_MS = 15_000;
const FOLLOW_UP = "run the follow-up";
const TMP_PREFIX = "dms-ai-drain-";
const STATE_FILE_NAME_TEST = "state.json";

interface ServerHandle {
  port: number;
  close: () => Promise<void>;
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

interface WireMessage {
  type: string;
  [key: string]: unknown;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolveOpen, rejectOpen) => {
    socket.once("open", () => resolveOpen());
    socket.once("error", rejectOpen);
  });
}

// Collect events until one satisfies `done` (auto-approving any permission
// prompt along the way), then resolve with everything seen so far.
function collectUntil(
  socket: WebSocket,
  done: (e: WireMessage) => boolean,
  timeoutMs: number,
): Promise<WireMessage[]> {
  return new Promise((resolveCollect, rejectCollect) => {
    const events: WireMessage[] = [];
    const timer = setTimeout(() => {
      rejectCollect(
        new Error(
          `timed out; saw ${JSON.stringify(events.map((e) => e.type))}`,
        ),
      );
    }, timeoutMs);
    socket.on("message", (data) => {
      const raw = rawDataToText(data);
      const parsed = JSON.parse(raw) as WireMessage;
      events.push(parsed);
      if (parsed.type === "permission_request") {
        socket.send(
          JSON.stringify({
            type: "permission_response",
            conversationId: parsed.conversationId,
            requestId: parsed.requestId,
            decision: "allow_once",
          }),
        );
      }
      if (done(parsed)) {
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

describe("server-driven queue drain", () => {
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

  it("dequeues an enqueued follow-up server-side and starts its own turn", async () => {
    const client = new WebSocket(
      `ws://${WS_HOST}:${handle.port}${WS_PATH_IFRAME}`,
      `dms-ai.${CLIENT_TOKEN}`,
    );
    await waitForOpen(client);
    // The server owns the queue: after the immediate turn completes it dequeues
    // the follow-up itself and echoes its user bubble. (The mock SDK replays its
    // script once per session, so the drained turn's model events aren't
    // produced here — the exactly-once dequeue is what this asserts.)
    const collected = collectUntil(
      client,
      (e) => e.type === "user_message_echo" && e.content === FOLLOW_UP,
      RUN_TIMEOUT_MS,
    );
    client.send(
      JSON.stringify({ type: "hello", role: "iframe", conversationId: CONV }),
    );
    client.send(
      JSON.stringify({
        type: "user_message",
        conversationId: CONV,
        content: "list",
      }),
    );
    client.send(
      JSON.stringify({
        type: "queue_enqueue",
        conversationId: CONV,
        item: { id: "q1", content: FOLLOW_UP },
      }),
    );
    const events = await collected;
    client.close();

    const types = events.map((e) => e.type);
    // The immediate turn ran to completion before the follow-up was dequeued.
    expect(types.indexOf("run_done")).toBeGreaterThanOrEqual(0);
    expect(types.lastIndexOf("run_done")).toBeLessThan(
      types.lastIndexOf("user_message_echo"),
    );
    // The queue reflected the item, then reflected its removal on dequeue.
    const queueSizes = events
      .filter((e) => e.type === "queue_state")
      .map((e) => (e.items as unknown[]).length);
    expect(queueSizes).toContain(1);
    expect(queueSizes[queueSizes.length - 1]).toBe(0);
  });

  it("replays an empty queue on re-attach to clear a stale client mirror", async () => {
    const client = new WebSocket(
      `ws://${WS_HOST}:${handle.port}${WS_PATH_IFRAME}`,
      `dms-ai.${CLIENT_TOKEN}`,
    );
    await waitForOpen(client);
    // The server queue is empty; re-attach must still send queue_state so a
    // client whose queue the server drained while away drops its phantom items.
    const collected = collectUntil(
      client,
      (e) => e.type === "queue_state",
      RUN_TIMEOUT_MS,
    );
    client.send(
      JSON.stringify({ type: "hello", role: "iframe", conversationId: CONV }),
    );
    const events = await collected;
    client.close();

    const queueState = events.find((e) => e.type === "queue_state");
    expect(queueState).toBeDefined();
    expect(queueState?.items).toEqual([]);
  });
});
