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

const SCRIPTS = resolve(__dirname, "../fixtures/mock-claude/scripts");
const PERMISSION_SCRIPT = join(SCRIPTS, "permission-required.json");
const MISSING_SCRIPT = join(SCRIPTS, "does-not-exist.json");
const CONV = "conv-proto-1";
const TEST_HOST_ROOT = "/tmp";
const ARBITRARY_PORT = 0;
const CLIENT_TOKEN = "queue-protocol-test-credential";
const WS_HOST = "127.0.0.1";
const WS_PATH_IFRAME = "/ws/iframe";
const TIMEOUT_MS = 15_000;
const TMP_PREFIX = "dms-ai-proto-";
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
      await new Promise<void>((r) => server.close(() => r()));
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}

interface WireMessage {
  type: string;
  [key: string]: unknown;
}

function open(port: number): Promise<WebSocket> {
  const socket = new WebSocket(
    `ws://${WS_HOST}:${port}${WS_PATH_IFRAME}`,
    `dms-ai.${CLIENT_TOKEN}`,
  );
  return new Promise((res, rej) => {
    socket.once("open", () => res(socket));
    socket.once("error", rej);
  });
}

interface WireMessageWaiter {
  pred: (e: WireMessage) => boolean;
  resolve: (e: WireMessage) => void;
}

/**
 * A running collector: records every event and lets a test await the next event
 * matching a predicate (from the current position onward).
 */
function collector(socket: WebSocket) {
  const events: WireMessage[] = [];
  const waiters: WireMessageWaiter[] = [];
  socket.on("message", (data) => {
    const parsed = JSON.parse(rawDataToText(data)) as WireMessage;
    events.push(parsed);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]?.pred(parsed)) {
        waiters.splice(i, 1)[0]?.resolve(parsed);
      }
    }
  });
  const next = (pred: (e: WireMessage) => boolean): Promise<WireMessage> =>
    new Promise((res, rej) => {
      const existing = events.find(pred);
      if (existing) return res(existing);
      const t = setTimeout(
        () => rej(new Error("timeout waiting for event")),
        TIMEOUT_MS,
      );
      waiters.push({
        pred,
        resolve: (e) => {
          clearTimeout(t);
          res(e);
        },
      });
    });
  return { events, next };
}

// `object`, not a message type: several cases send a frame the protocol should
// reject, and not `unknown`, which would let `send(socket, undefined)` compile
// into a socket write that puts nothing on the wire and hangs the case.
// oxlint-disable-next-line anti-slop/no-object-parameters
const send = (socket: WebSocket, msg: object): void =>
  socket.send(JSON.stringify(msg));
const queueSize = (e: WireMessage): number => (e.items as unknown[]).length;

describe("queue protocol while a turn holds the drain lock", () => {
  let handle: ServerHandle;

  beforeEach(async () => {
    process.env.MOCK_CLAUDE = "1";
    process.env.MOCK_CLAUDE_SCRIPT = PERMISSION_SCRIPT;
    handle = await startTestServer();
  });
  afterEach(async () => {
    delete process.env.MOCK_CLAUDE;
    delete process.env.MOCK_CLAUDE_SCRIPT;
    await handle.close();
  });

  it("enqueues, orders, and cancels while paused, then drains after approval", async () => {
    const socket = await open(handle.port);
    const c = collector(socket);
    send(socket, { type: "hello", role: "iframe", conversationId: CONV });
    send(socket, { type: "user_message", conversationId: CONV, content: "go" });

    const perm = await c.next((e) => e.type === "permission_request");

    send(socket, {
      type: "queue_enqueue",
      conversationId: CONV,
      item: { id: "A", content: "first" },
    });
    const afterA = await c.next(
      (e) => e.type === "queue_state" && queueSize(e) === 1,
    );
    expect((afterA.items as { id: string }[]).map((i) => i.id)).toEqual(["A"]);

    send(socket, {
      type: "queue_enqueue",
      conversationId: CONV,
      item: { id: "B", content: "second" },
    });
    const afterB = await c.next(
      (e) => e.type === "queue_state" && queueSize(e) === 2,
    );
    expect((afterB.items as { id: string }[]).map((i) => i.id)).toEqual([
      "A",
      "B",
    ]);

    send(socket, { type: "queue_cancel", conversationId: CONV, id: "A" });
    const afterCancel = await c.next(
      (e) =>
        e.type === "queue_state" &&
        queueSize(e) === 1 &&
        (e.items as { id: string }[])[0]?.id === "B",
    );
    expect((afterCancel.items as { id: string }[])[0]?.id).toBe("B");

    send(socket, {
      type: "permission_response",
      conversationId: CONV,
      requestId: perm.requestId,
      decision: "allow_once",
    });
    const echoB = await c.next(
      (e) => e.type === "user_message_echo" && e.content === "second",
    );
    expect(echoB.content).toBe("second");
    await c.next((e) => e.type === "queue_state" && queueSize(e) === 0);
    socket.close();
  });

  it("folds a concurrent immediate message into the queue (no parallel drain)", async () => {
    const socket = await open(handle.port);
    const c = collector(socket);
    send(socket, { type: "hello", role: "iframe", conversationId: CONV });
    send(socket, { type: "user_message", conversationId: CONV, content: "go" });
    const perm = await c.next((e) => e.type === "permission_request");

    send(socket, {
      type: "user_message",
      conversationId: CONV,
      content: "stray immediate",
    });
    const queued = await c.next(
      (e) =>
        e.type === "queue_state" &&
        (e.items as { content: string }[]).some(
          (i) => i.content === "stray immediate",
        ),
    );
    expect(queueSize(queued)).toBe(1);

    const permCount = c.events.filter(
      (e) => e.type === "permission_request",
    ).length;
    expect(permCount).toBe(1);

    send(socket, {
      type: "permission_response",
      conversationId: CONV,
      requestId: perm.requestId,
      decision: "allow_once",
    });
    const echo = await c.next(
      (e) => e.type === "user_message_echo" && e.content === "stray immediate",
    );
    expect(echo.content).toBe("stray immediate");
    socket.close();
  });
});

describe("turn error delivery (artificial failure)", () => {
  let handle: ServerHandle;

  beforeEach(async () => {
    process.env.MOCK_CLAUDE = "1";
    process.env.MOCK_CLAUDE_SCRIPT = MISSING_SCRIPT;
    handle = await startTestServer();
  });
  afterEach(async () => {
    delete process.env.MOCK_CLAUDE;
    delete process.env.MOCK_CLAUDE_SCRIPT;
    await handle.close();
  });

  it("delivers run_error (not a hang) when the runner stream fails", async () => {
    const socket = await open(handle.port);
    const c = collector(socket);
    send(socket, { type: "hello", role: "iframe", conversationId: CONV });
    send(socket, {
      type: "user_message",
      conversationId: CONV,
      content: "boom",
    });
    const err = await c.next((e) => e.type === "run_error");
    expect(typeof err.error).toBe("string");
    socket.close();
  });
});
