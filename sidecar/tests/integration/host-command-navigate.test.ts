import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildNavigateToPageTool } from "../../src/mcp/tools/navigate-to-page.js";
import {
  createHostSocketRegistry,
  type HostSocketRegistry,
} from "../../src/server/host-socket-registry.js";
import { createHttpServer } from "../../src/server/http.js";
import {
  createNavigationCompleter,
  type NavigationCompleter,
} from "../../src/server/navigation-completer.js";
import { attachWsServer } from "../../src/server/ws.js";
import { createConversationStore } from "../../src/state/conversations.js";
import { createHostState } from "../../src/state/host-state.js";
import { createStore } from "../../src/state/store.js";
import { rawDataToText } from "../../src/server/raw-data.js";

const ARBITRARY_PORT = 0;
const CLIENT_TOKEN = "host-navigation-test-credential";
const TEST_HOST_ROOT = "/tmp";
const WS_PATH_HOST = "/ws/host";
const WS_HOST = "127.0.0.1";
const TMP_PREFIX = "dms-ai-host-cmd-navigate-";
const STATE_FILE_NAME_TEST = "state.json";
const SETTLE_DELAY_MS = 50;
const NAVIGATE_TARGET = "/dashboard/settings";

interface ServerHandle {
  port: number;
  hostSocketRegistry: HostSocketRegistry;
  navigationCompleter: NavigationCompleter;
  tmpDir: string;
  close: () => Promise<void>;
}

interface ToolHandlerLike {
  handler: (
    args: { path: string },
    extra: unknown,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
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
    hostSocketRegistry,
    navigationCompleter,
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

function buildHostUrl(port: number): string {
  return `ws://${WS_HOST}:${port}${WS_PATH_HOST}`;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolveOpen, rejectOpen) => {
    socket.once("open", () => resolveOpen());
    socket.once("error", rejectOpen);
  });
}

function waitForMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolveMsg) => {
    socket.once("message", (data) => {
      const raw = rawDataToText(data);
      resolveMsg(JSON.parse(raw));
    });
  });
}

function settle(): Promise<void> {
  return new Promise((resolveSettle) =>
    setTimeout(resolveSettle, SETTLE_DELAY_MS),
  );
}

function sendHostHello(socket: WebSocket): void {
  socket.send(JSON.stringify({ type: "hello", role: "host" }));
}

describe("navigate_to_page → host_command_navigate over host WS", () => {
  let handle: ServerHandle;

  beforeEach(async () => {
    handle = await startTestServer();
  });

  afterEach(async () => {
    await handle.close();
  });

  it("delivers the navigate event to the registered host socket", async () => {
    const client = new WebSocket(
      buildHostUrl(handle.port),
      `dms-ai.${CLIENT_TOKEN}`,
    );
    await waitForOpen(client);
    sendHostHello(client);
    await settle();
    const incoming = waitForMessage(client);
    const toolDef = buildNavigateToPageTool({
      sendToHost: handle.hostSocketRegistry.send,
      navigationCompleter: handle.navigationCompleter,
      registry: {
        getRegistry: async () => [],
        getStaleSinceMs: () => null,
        invalidate: () => {},
      },
      getCurrentPage: () => ({ path: "unknown" }),
    }) as unknown as ToolHandlerLike;
    const handlerPromise = toolDef.handler(
      { path: NAVIGATE_TARGET },
      undefined,
    );
    const received = await incoming;
    handle.navigationCompleter.complete(NAVIGATE_TARGET);
    await handlerPromise;
    client.close();
    expect(received).toEqual({
      type: "host_command_navigate",
      path: NAVIGATE_TARGET,
    });
  });

  it("does not throw when no host is connected", async () => {
    const toolDef = buildNavigateToPageTool({
      sendToHost: handle.hostSocketRegistry.send,
      navigationCompleter: handle.navigationCompleter,
      registry: {
        getRegistry: async () => [],
        getStaleSinceMs: () => null,
        invalidate: () => {},
      },
      getCurrentPage: () => ({ path: "unknown" }),
    }) as unknown as ToolHandlerLike;
    const handlerPromise = toolDef.handler({ path: "/x" }, undefined);
    // Let the handler's async route-validation step run before completing.
    await settle();
    handle.navigationCompleter.complete("/x");
    const result = await handlerPromise;
    expect(result.content[0]?.text).toContain("/x");
  });
});
