import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderSession } from "../../src/agent/provider.js";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import {
  createMcpHttpRegistry,
  type McpHttpRegistry,
} from "../../src/mcp/http-binding.js";
import type { AiMcpServerDeps } from "../../src/mcp/types.js";
import { createCodexProvider } from "../../src/providers/codex/provider.js";
import { createHttpServer } from "../../src/server/http.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";
import { CODEX_FIXTURE, codexScript } from "../helpers/provider-fixtures.js";

const CONVERSATION_A = "conv-iso-a";
const CONVERSATION_B = "conv-iso-b";
const TEST_TIMEOUT_MS = 30_000;

// Each conversation gets its own MCP deps, so a tool answer is traceable back
// to the conversation whose bearer carried the call.
function buildDeps(conversationId: string): AiMcpServerDeps {
  return {
    getCurrentPage: () => ({ path: `${UNKNOWN_PAGE_PATH}/${conversationId}` }),
    registry: {
      getRegistry: async () => [],
      getStaleSinceMs: () => null,
      invalidate: () => {},
    },
    scanner: {
      scan: async () => ({ importersByFile: new Map() }),
      invalidate: () => {},
    },
    hostProjectRoot: "/tmp",
    moduleRoots: [],
    logsClient: { getLogs: async () => [] },
    builderClient: { call: async () => undefined },
    builderEnabled: false,
    sendToHost: () => {},
    navigationCompleter: createNavigationCompleter(),
    conversationId,
    requestQuestion: async () => null,
    getLastEditedFile: () => undefined,
  };
}

function toolResults(events: RunnerEvent[]): unknown[] {
  return events
    .filter((event) => event.type === "tool_result")
    .map((event) => (event.type === "tool_result" ? event.result : null));
}

describe("two live Codex conversations stay isolated", () => {
  let dir: string;
  let server: Server | undefined;
  let registry: McpHttpRegistry | undefined;
  const sessions: ProviderSession[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-iso-"));
    CODEX_FIXTURE.use("plain");
    process.env.MOCK_CODEX_SCRIPT = codexScript("mcp-current-page.jsonl");
  });

  afterEach(async () => {
    for (const session of sessions.splice(0)) session.dispose();
    await registry?.dispose();
    registry = undefined;
    await new Promise<void>((done) => {
      if (server === undefined) {
        done();
        return;
      }
      server.close(() => done());
    });
    server = undefined;
    CODEX_FIXTURE.reset();
    await rm(dir, { recursive: true, force: true });
  });

  it(
    "routes each conversation's MCP tool call to its own dependencies",
    async () => {
      registry = createMcpHttpRegistry();
      const started = await createHttpServer({
        clientToken: "integration-test-credential",
        chatboxDistDir: dir,
        port: 0,
        mcpHttpRegistry: registry,
      });
      server = started.server;
      const provider = createCodexProvider({
        settings: DEFAULT_SETTINGS,
        stateDir: join(dir, ".state"),
        mcpHttpRegistry: registry,
        createMcpDeps: buildDeps,
        getMcpUrl: () => `http://127.0.0.1:${started.port}/mcp`,
        getApiKey: () => "sk-mock",
      });

      const open = async (conversationId: string): Promise<ProviderSession> => {
        const session = await provider.createSession({
          conversationId,
          hostProjectRoot: dir,
          getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
          settings: DEFAULT_SETTINGS,
          onDisposed: () => {},
        });
        sessions.push(session);
        return session;
      };

      // Both processes are alive at once, each holding its own bearer.
      const [a, b] = await Promise.all([
        open(CONVERSATION_A),
        open(CONVERSATION_B),
      ]);

      const run = async (session: ProviderSession): Promise<RunnerEvent[]> => {
        const events: RunnerEvent[] = [];
        for await (const event of session.runTurn(
          { text: "where am I", attachments: [] },
          DEFAULT_SETTINGS,
        )) {
          events.push(event);
        }
        return events;
      };
      const [eventsA, eventsB] = await Promise.all([run(a), run(b)]);

      const textA = JSON.stringify(toolResults(eventsA));
      const textB = JSON.stringify(toolResults(eventsB));
      expect(textA).toContain(CONVERSATION_A);
      expect(textA).not.toContain(CONVERSATION_B);
      expect(textB).toContain(CONVERSATION_B);
      expect(textB).not.toContain(CONVERSATION_A);
    },
    TEST_TIMEOUT_MS,
  );
});
