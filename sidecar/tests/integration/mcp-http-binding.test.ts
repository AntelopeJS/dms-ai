import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import type { QuestionRequest } from "../../src/agent/question-bus.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { HTTP_STATUS } from "../../src/constants/http.js";
import {
  ASK_USER_TOOL_NAME,
  GET_CURRENT_PAGE_TOOL_NAME,
  MCP_HTTP_PATH,
} from "../../src/constants/mcp.js";
import type { LogsClient } from "../../src/logs/logs-client.js";
import {
  createMcpHttpRegistry,
  type McpHttpRegistry,
} from "../../src/mcp/http-binding.js";
import type { AiMcpServerDeps } from "../../src/mcp/types.js";
import type { ImportsScanner } from "../../src/pages/imports-scanner.js";
import type { RegistryClient } from "../../src/pages/registry-client.js";
import { createHttpServer } from "../../src/server/http.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";

const CONVERSATION_A = "conv-mcp-a";
const CONVERSATION_B = "conv-mcp-b";
const ARBITRARY_PORT = 0;
const LOOPBACK = "127.0.0.1";
const TEST_HOST_ROOT = "/tmp";
const CLIENT_NAME = "mcp-http-binding-test";
const CLIENT_VERSION = "0.0.1";
const QUESTION_HEADER = "Pick";
const ANSWER = "yes";

interface AskedQuestion {
  conversationId: string;
}

function buildDeps(
  conversationId: string,
  asked: AskedQuestion[],
): AiMcpServerDeps {
  const registry: RegistryClient = {
    getRegistry: async () => [],
    getStaleSinceMs: () => null,
    invalidate: () => {},
  };
  const scanner: ImportsScanner = {
    scan: async () => ({ importersByFile: new Map() }),
    invalidate: () => {},
  };
  const logsClient: LogsClient = { getLogs: async () => [] };
  return {
    getCurrentPage: () => ({ path: `${UNKNOWN_PAGE_PATH}/${conversationId}` }),
    registry,
    scanner,
    hostProjectRoot: TEST_HOST_ROOT,
    moduleRoots: [],
    logsClient,
    builderClient: { call: async () => undefined },
    builderEnabled: false,
    sendToHost: () => {},
    navigationCompleter: createNavigationCompleter(),
    conversationId,
    requestQuestion: async (req: QuestionRequest) => {
      asked.push({ conversationId: req.conversationId });
      return [ANSWER];
    },
    getLastEditedFile: () => undefined,
  };
}

interface Harness {
  port: number;
  registry: McpHttpRegistry;
  server: Server;
  tokenA: string;
  tokenB: string;
  asked: AskedQuestion[];
}

async function startHarness(): Promise<Harness> {
  const asked: AskedQuestion[] = [];
  const registry = createMcpHttpRegistry();
  const tokenA = await registry.register(buildDeps(CONVERSATION_A, asked));
  const tokenB = await registry.register(buildDeps(CONVERSATION_B, asked));
  const { server, port } = await createHttpServer({
    clientToken: "integration-test-credential",
    chatboxDistDir: TEST_HOST_ROOT,
    port: ARBITRARY_PORT,
    mcpHttpRegistry: registry,
  });
  return { port, registry, server, tokenA, tokenB, asked };
}

async function connectClient(port: number, token: string): Promise<Client> {
  const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://${LOOPBACK}:${port}${MCP_HTTP_PATH}`),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  );
  await client.connect(transport);
  return client;
}

describe("MCP streamable HTTP binding", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    if (harness === undefined) return;
    await harness.registry.dispose();
    await new Promise<void>((done) => harness?.server.close(() => done()));
    harness = undefined;
  });

  it("exposes the first-party tools to a standard MCP client", async () => {
    harness = await startHarness();
    const client = await connectClient(harness.port, harness.tokenA);
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    expect(names).toContain(GET_CURRENT_PAGE_TOOL_NAME);
    expect(names).toContain(ASK_USER_TOOL_NAME);
    await client.close();
  });

  it("keeps two concurrent conversations isolated by their bearer", async () => {
    harness = await startHarness();
    const clientA = await connectClient(harness.port, harness.tokenA);
    const clientB = await connectClient(harness.port, harness.tokenB);

    await clientA.callTool({
      name: ASK_USER_TOOL_NAME,
      arguments: {
        questions: [
          {
            question: "A?",
            header: QUESTION_HEADER,
            options: [
              { label: ANSWER, description: "d" },
              { label: "no", description: "d" },
            ],
            multiSelect: false,
          },
        ],
      },
    });
    expect(harness.asked).toEqual([{ conversationId: CONVERSATION_A }]);

    await clientB.callTool({
      name: ASK_USER_TOOL_NAME,
      arguments: {
        questions: [
          {
            question: "B?",
            header: QUESTION_HEADER,
            options: [
              { label: ANSWER, description: "d" },
              { label: "no", description: "d" },
            ],
            multiSelect: false,
          },
        ],
      },
    });
    expect(harness.asked).toEqual([
      { conversationId: CONVERSATION_A },
      { conversationId: CONVERSATION_B },
    ]);

    await clientA.close();
    await clientB.close();
  });

  it("refuses a request with no bearer token", async () => {
    harness = await startHarness();
    const response = await fetch(
      `http://${LOOPBACK}:${harness.port}${MCP_HTTP_PATH}`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
    );
    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it("refuses a request with an unknown bearer token", async () => {
    harness = await startHarness();
    const response = await fetch(
      `http://${LOOPBACK}:${harness.port}${MCP_HTTP_PATH}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer deadbeef",
        },
      },
    );
    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it("refuses a non-loopback Origin, closing the DNS rebinding path", async () => {
    harness = await startHarness();
    const response = await fetch(
      `http://${LOOPBACK}:${harness.port}${MCP_HTTP_PATH}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${harness.tokenA}`,
          Origin: "http://evil.example.com",
        },
      },
    );
    expect(response.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it("releases a conversation's binding", async () => {
    harness = await startHarness();
    await harness.registry.release(CONVERSATION_A);
    const response = await fetch(
      `http://${LOOPBACK}:${harness.port}${MCP_HTTP_PATH}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${harness.tokenA}`,
        },
      },
    );
    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});
