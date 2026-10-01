import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { formatHostContext } from "../../src/agent/host-context.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { buildGetCurrentPageTool } from "../../src/mcp/tools/get-current-page.js";
import { createPageFilepathResolver } from "../../src/pages/page-filepath.js";
import type { RegistryClient } from "../../src/pages/registry-client.js";
import type { PagesRegistryEntry } from "../../src/pages/types.js";
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
const WS_PATH = "/ws";
const WS_HOST = "127.0.0.1";
const TMP_PREFIX = "dms-ai-host-state-";
const STATE_FILE_NAME_TEST = "state.json";
const SETTLE_DELAY_MS = 50;
const ABOUT_FILE = "pages/about.vue";
const REGISTERED_PAGES: PagesRegistryEntry[] = [
  { id: "about", path: "/about", filepath: ABOUT_FILE, moduleId: "app" },
];

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
    port: ARBITRARY_PORT,
  });
  const registry: RegistryClient = {
    getRegistry: async () => REGISTERED_PAGES,
    getStaleSinceMs: () => null,
    invalidate: () => {},
  };
  const hostState = createHostState({
    resolveFilepath: createPageFilepathResolver(registry, TEST_HOST_ROOT),
  });
  const hostSocketRegistry = createHostSocketRegistry();
  const navigationCompleter = createNavigationCompleter();
  const mcpDeps = {
    getCurrentPage: () => hostState.getCurrentPage(),
    registry,
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
  return `ws://${WS_HOST}:${port}${WS_PATH}`;
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

  it("records the reported title and the source file resolved from the route", async () => {
    const client = new WebSocket(buildHostUrl(handle.port), {
      headers: { Authorization: `Bearer ${CLIENT_TOKEN}` },
    });
    await waitForOpen(client);
    client.send(
      JSON.stringify({
        type: "host_state_update",
        currentPage: {
          path: "/about",
          filepath: "pages/spoofed.vue",
          title: "About",
        },
      }),
    );
    await settle();
    client.close();
    const resolvedFile = join(TEST_HOST_ROOT, ABOUT_FILE);
    expect(handle.hostState.getCurrentPage()).toEqual({
      path: "/about",
      title: "About",
      filepath: resolvedFile,
    });
    const block = formatHostContext(handle.hostState.getCurrentPage(), "vibe");
    expect(block).toContain("page: /about");
    expect(block).toContain("title: About");
    expect(block).toContain(`file: ${resolvedFile}`);
  });

  it("get_current_page tool reports the latest pushed state", async () => {
    const client = new WebSocket(buildHostUrl(handle.port), {
      headers: { Authorization: `Bearer ${CLIENT_TOKEN}` },
    });
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
