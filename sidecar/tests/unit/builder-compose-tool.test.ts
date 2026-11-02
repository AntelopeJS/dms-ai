import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { isReadOnlyTool } from "../../src/agent/tool-kinds.js";
import { BUILDER_TOOL_NAMES } from "../../src/constants/builder.js";
import {
  FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES,
  MCP_TOOL_NAME_PREFIX,
} from "../../src/constants/mcp.js";
import { BUILDER_MUTATING_TOOL_NAMES } from "../../src/constants/tool-kinds.js";
import type { BuilderGate } from "../../src/mcp/tools/builder-gate.js";
import { createAiMcpServer } from "../../src/mcp/sdk-binding.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import type { JsonValue } from "../../src/protocol/json.js";

const PAGE = "pages.shop.shop-orders";

interface Recorded {
  op: string;
  args: unknown[];
}

function startServer(gate?: BuilderGate, answer?: JsonValue) {
  const calls: Recorded[] = [];
  const server = createAiMcpServer({
    getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
    registry: {
      getRegistry: async () => [],
      getStaleSinceMs: () => null,
      invalidate: () => {},
    },
    scanner: {
      scan: async () => ({ importersByFile: new Map() }),
      invalidate: () => {},
    },
    hostProjectRoot: "/tmp/host",
    moduleRoots: [],
    logsClient: { getLogs: async () => [] },
    builderClient: {
      call: async (op, args) => {
        calls.push({ op, args });
        return answer ?? { ok: true, data: { path: PAGE }, changes: [] };
      },
    },
    databaseClient: { get: async () => [], post: async () => ({}) },
    builderEnabled: true,
    sendToHost: () => {},
    navigationCompleter: createNavigationCompleter(),
    conversationId: "conv-query-tools",
    requestQuestion: async () => null,
    getLastEditedFile: () => undefined,
    showPreview: () => {},
    listAttachedImages: () => [],
    gateBuilderOp: gate,
  });
  return { server, calls };
}

function isMcpServer(
  value: ReturnType<typeof createAiMcpServer>["instance"],
): value is McpServer {
  return "connect" in value && typeof value.connect === "function";
}

type ToolArguments = NonNullable<
  Parameters<Client["callTool"]>[0]["arguments"]
>;

async function withClient<T>(
  server: ReturnType<typeof createAiMcpServer>,
  use: (client: Client) => Promise<T>,
): Promise<T> {
  const { instance } = server;
  if (!isMcpServer(instance)) throw new Error("not an McpServer");
  const client = new Client({ name: "builder-query-tools", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    instance.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    return await use(client);
  } finally {
    await client.close();
  }
}

async function callTool(name: string, args: ToolArguments, answer?: JsonValue) {
  const { server, calls } = startServer(undefined, answer);
  const result = await withClient(server, (client) =>
    client.callTool({ name, arguments: args }),
  );
  return { result, calls };
}

const KPI_ROW = {
  name: "kpis",
  type: "GridRow",
  children: [
    {
      name: "revenue",
      type: "KpiCard",
      config: { title: "Revenue", periodScope: "page" },
      query: {
        resource: "/shop/orders",
        template: "series",
        params: { op: "sum", field: "total", groupBy: "created_at" },
        response: "value",
        compare: true,
      },
    },
  ],
};

describe("BuilderComposePage", () => {
  it("is a mutating Builder tool the assistant may call without a prompt", () => {
    expect(BUILDER_TOOL_NAMES).toContain("BuilderComposePage");
    expect(BUILDER_MUTATING_TOOL_NAMES).toContain("BuilderComposePage");
    expect(
      FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES.has(
        `${MCP_TOOL_NAME_PREFIX}BuilderComposePage`,
      ),
    ).toBe(true);
    expect(isReadOnlyTool("BuilderComposePage")).toBe(false);
  });

  it("hands the Builder one ComposePage call with the page, the placement and the nested blocks", async () => {
    const { result, calls } = await callTool("BuilderComposePage", {
      pageRef: PAGE,
      placement: { before: "table" },
      blocks: [KPI_ROW],
    });
    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([
      {
        op: "ComposePage",
        args: [
          { page: PAGE, placement: { before: "table" }, blocks: [KPI_ROW] },
        ],
      },
    ]);
  });

  it("creates the page in the same call and passes preview and args through", async () => {
    const create = {
      name: "analytics",
      displayName: "Analytics",
      category: "pages.shop",
      icon: "chart-line",
      order: 2,
    };
    const args = { from: "2026-01-01", to: "2026-03-31" };
    const { calls } = await callTool("BuilderComposePage", {
      create,
      blocks: [KPI_ROW],
      preview: true,
      args,
    });
    expect(calls).toEqual([
      {
        op: "ComposePage",
        args: [{ create, blocks: [KPI_ROW], preview: true, args }],
      },
    ]);
  });

  it("refuses an empty page, an unknown key and an $expr sentinel without calling the Builder", async () => {
    const wrong = [
      { pageRef: PAGE, blocks: [] },
      {
        pageRef: PAGE,
        blocks: [{ name: "x", type: "KpiCard", query: { resource: "r" } }],
      },
      {
        pageRef: PAGE,
        blocks: [
          { name: "x", type: "KpiCard", config: { title: { $expr: "1 + 1" } } },
        ],
      },
    ];
    for (const input of wrong) {
      const { result, calls } = await callTool("BuilderComposePage", input);
      expect(result.isError, JSON.stringify(input)).toBe(true);
      expect(calls).toEqual([]);
    }
  });
});
