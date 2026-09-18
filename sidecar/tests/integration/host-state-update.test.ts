import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { buildGetCurrentPageTool } from "../../src/mcp/tools/get-current-page.js";
import { createHostSocketRegistry } from "../../src/server/host-socket-registry.js";
import { createHttpServer } from "../../src/server/http.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";
import { createMcpHttpRegistry } from "../../src/mcp/http-binding.js";
import { attachWsServer } from "../../src/server/ws.js";
import { createConversationStore } from "../../src/state/conversations.js";
import { createHostState, type HostState } from "../../src/state/host-state.js";
import { createStore } from "../../src/state/store.js";

const ARBITRARY_PORT = 0;
const CLIENT_TOKEN = "host-state-test-credential";
const TEST_HOST_ROOT = "/tmp";
const WS_PATH_HOST = "/ws/host";
const WS_HOST = "127.0.0.1";
const TMP_PREFIX = "dms-ai-host-state-";
const STATE_FILE_NAME_TEST = "state.json";
const SETTLE_DELAY_MS = 50;

interface ServerHandle {
  port: number;
  hostState: HostState;
  tmpDir: string;
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
    providerRuntime: {
      stateDir: join(tmpdir(), "dms-ai-ws-stub"),
      mcpHttpRegistry: createMcpHttpRegistry(),
      getMcpUrl: () => "http://127.0.0.1:1/mcp",
    },
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
    hostState,
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

function settle(): Promise<void> {
  return new Promise((resolveSettle) =>
    setTimeout(resolveSettle, SETTLE_DELAY_MS),
  );
}

interface ToolHandlerLike {
  handler: (
    args: Record<string, never>,
    extra: unknown,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
}

describe("host_state_update WS message", () => {
  let handle: ServerHandle;

  beforeEach(async () => {
    handle = await startTestServer();
  });

  afterEach(async () => {
    await handle.close();
  });

  it("updates the sidecar host state when host pushes host_state_update", async () => {
    const client = new WebSocket(
      buildHostUrl(handle.port),
      `dms-ai.${CLIENT_TOKEN}`,
    );
    await waitForOpen(client);
    client.send(
      JSON.stringify({
        type: "host_state_update",
        currentPage: {
          path: "/about",
          filepath: "pages/about.vue",
          title: "About",
        },
      }),
    );
    await settle();
    client.close();
    expect(handle.hostState.getCurrentPage()).toEqual({
      path: "/about",
      filepath: "pages/about.vue",
      title: "About",
    });
  });

  it("get_current_page tool reports the latest pushed state", async () => {
    const client = new WebSocket(
      buildHostUrl(handle.port),
      `dms-ai.${CLIENT_TOKEN}`,
    );
    await waitForOpen(client);
    client.send(
      JSON.stringify({
        type: "host_state_update",
        currentPage: { path: "/dashboard" },
      }),
    );
    await settle();
    client.close();
    const toolDef = buildGetCurrentPageTool(() =>
      handle.hostState.getCurrentPage(),
    ) as unknown as ToolHandlerLike;
    const result = await toolDef.handler({}, undefined);
    const text = result.content[0]?.text ?? "";
    expect(JSON.parse(text)).toEqual({ path: "/dashboard" });
  });

  it("returns the unknown page when no host_state_update arrived yet", async () => {
    const toolDef = buildGetCurrentPageTool(() =>
      handle.hostState.getCurrentPage(),
    ) as unknown as ToolHandlerLike;
    const result = await toolDef.handler({}, undefined);
    const text = result.content[0]?.text ?? "";
    expect(JSON.parse(text)).toEqual({ path: UNKNOWN_PAGE_PATH });
  });
});
