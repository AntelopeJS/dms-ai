import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createHttpServer } from "../../src/server/http.js";
import { createMcpHttpRegistry } from "../../src/mcp/http-binding.js";
import { attachWsServer } from "../../src/server/ws.js";
import { createHostSocketRegistry } from "../../src/server/host-socket-registry.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";
import { createConversationStore } from "../../src/state/conversations.js";
import { createHostState } from "../../src/state/host-state.js";
import { createSettingsStore } from "../../src/state/settings-store.js";
import { createStore } from "../../src/state/store.js";

const CLIENT_TOKEN = "client-auth-regression-credential";
const FOREIGN_ORIGIN = "https://attacker.invalid";
const TIMEOUT_MS = 2000;
const NEXT_SETTINGS = {
  mode: "auto",
  thinking: "medium",
  generationMode: "vibe",
  allowLocalSkills: false,
};

function buildContext(directory: string) {
  const conversationStore = createConversationStore({
    store: createStore({ filePath: join(directory, "state.json") }),
  });
  const settingsStore = createSettingsStore({
    filePath: join(directory, "settings.json"),
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
    hostProjectRoot: directory,
    moduleRoots: [],
    logsClient: { getLogs: async () => [] },
    builderClient: {
      call: async () => {
        throw new Error("Agent execution is outside this test");
      },
    },
    builderEnabled: false,
    sendToHost: hostSocketRegistry.send,
    navigationCompleter,
  };
  return {
    clientToken: CLIENT_TOKEN,
    hostProjectRoot: directory,
    conversationStore,
    settingsStore,
    settingsApplier: { apply: () => {} },
    hostState,
    hostSocketRegistry,
    navigationCompleter,
    mcpDeps,
    providerRuntime: {
      stateDir: join(directory, ".state"),
      mcpHttpRegistry: createMcpHttpRegistry(),
      getMcpUrl: () => "http://127.0.0.1:1/mcp",
    },
  };
}

async function startServer() {
  const directory = await mkdtemp(join(tmpdir(), "dms-ai-auth-"));
  const context = buildContext(directory);
  const { server, port } = await createHttpServer({
    ...context,
    chatboxDistDir: directory,
    port: 0,
    getSkillSources: () => [],
  });
  const sockets = attachWsServer(server, context);
  return {
    port,
    settingsStore: context.settingsStore,
    close: async () => {
      await sockets.close();
      await context.settingsStore.flush();
      await context.conversationStore.flush();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe("sidecar client authentication", () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  const clients: WebSocket[] = [];
  beforeEach(async () => {
    server = await startServer();
  });
  afterEach(async () => {
    clients.splice(0).forEach((client) => client.terminate());
    await server.close();
  });

  it("rejects unauthorized API reads and mutations without changing settings", async () => {
    for (const path of [
      "/settings",
      "/skills",
      "/activity",
      "/metrics/series",
      "/metrics/kpi/cost",
    ]) {
      const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
        headers: { Origin: FOREIGN_ORIGIN },
      });
      expect(response.status).toBe(401);
    }
    for (const authorization of [
      "",
      "Bearer wrong-token",
      `Bearer ${CLIENT_TOKEN}suffix`,
    ]) {
      const response = await fetch(`http://127.0.0.1:${server.port}/settings`, {
        method: "PUT",
        headers: {
          Authorization: authorization,
          "content-type": "application/json",
          Origin: FOREIGN_ORIGIN,
        },
        body: JSON.stringify(NEXT_SETTINGS),
      });
      expect(response.status).toBe(401);
      expect(server.settingsStore.get().mode).toBe("normal");
    }
  });

  it("allows the authenticated proxy to apply settings", async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/settings`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${CLIENT_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(NEXT_SETTINGS),
    });
    expect(response.status).toBe(200);
    expect(server.settingsStore.get().mode).toBe("auto");
  });

  it("rejects both WS roles without a valid explicit credential, even with cookies or query tokens", async () => {
    for (const role of ["host", "iframe"]) {
      for (const protocol of [undefined, "dms-ai.wrong"]) {
        const client = new WebSocket(
          `ws://127.0.0.1:${server.port}/ws/${role}?token=${CLIENT_TOKEN}`,
          protocol,
          {
            origin: FOREIGN_ORIGIN,
            headers: { Cookie: `token=${CLIENT_TOKEN}` },
            handshakeTimeout: TIMEOUT_MS,
          },
        );
        clients.push(client);
        await expect(once(client, "open")).rejects.toThrow("401");
      }
    }
  });

  it("accepts browser subprotocol credentials on both roles", async () => {
    for (const role of ["host", "iframe"]) {
      const client = new WebSocket(
        `ws://127.0.0.1:${server.port}/ws/${role}`,
        `dms-ai.${CLIENT_TOKEN}`,
        { handshakeTimeout: TIMEOUT_MS },
      );
      clients.push(client);
      await once(client, "open");
      expect(client.readyState).toBe(WebSocket.OPEN);
    }
  });
});
