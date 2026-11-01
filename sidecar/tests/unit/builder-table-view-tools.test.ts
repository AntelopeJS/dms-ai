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

describe("BuilderConfigureTableView", () => {
  it("is a mutating Builder tool the assistant may call without a prompt", () => {
    expect(BUILDER_TOOL_NAMES).toContain("BuilderConfigureTableView");
    expect(BUILDER_MUTATING_TOOL_NAMES).toContain("BuilderConfigureTableView");
    expect(
      FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES.has(
        `${MCP_TOOL_NAME_PREFIX}BuilderConfigureTableView`,
      ),
    ).toBe(true);
    expect(isReadOnlyTool("BuilderConfigureTableView")).toBe(false);
  });

  it("hands the Builder the page and the settings it was given, nothing else", async () => {
    const settings = {
      kanban: { groupBy: "status" },
      cards: { fields: ["status", "total"] },
      defaultDisplay: "kanban",
      views: {
        layout: "strip",
        items: [
          {
            id: "late",
            label: "Late",
            filters: [
              { column: "status", value: ["pending", "paid"], mode: "include" },
            ],
            sort: [{ column: "created_at", desc: true }],
          },
        ],
      },
      footer: {
        summary: [
          { label: "Revenue", op: "sum", field: "total" },
          {
            label: "Cancelled",
            op: "count",
            where: { column: "status", op: "equals", value: "cancelled" },
          },
        ],
      },
    };
    const { result, calls } = await callTool("BuilderConfigureTableView", {
      pageRef: PAGE,
      ...settings,
    });
    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([
      { op: "ConfigureTableView", args: [PAGE, settings] },
    ]);
  });

  it("names the block when the page holds several, and passes null to remove a setting", async () => {
    const { calls } = await callTool("BuilderConfigureTableView", {
      pageRef: PAGE,
      block: "orders",
      kanban: null,
      footer: null,
    });
    expect(calls).toEqual([
      {
        op: "ConfigureTableView",
        args: [PAGE, { kanban: null, footer: null }, { block: "orders" }],
      },
    ]);
  });

  it("refuses a display, an operation or a layout it does not know, without calling the Builder", async () => {
    const wrong = [
      { defaultDisplay: "gantt" },
      { footer: { summary: [{ label: "x", op: "average", field: "total" }] } },
      { views: { layout: "grid", items: [] } },
      { kanban: { draggable: true } },
    ];
    for (const settings of wrong) {
      const { result, calls } = await callTool("BuilderConfigureTableView", {
        pageRef: PAGE,
        ...settings,
      });
      expect(result.isError).toBe(true);
      expect(calls).toEqual([]);
    }
  });

  it("answers the Builder's refusal as a failed call the assistant reads", async () => {
    const refused = {
      ok: false,
      error: {
        code: "invalid_config",
        issues: [{ pointer: "/kanban/groupBy", message: "no" }],
      },
    };
    const { result } = await callTool(
      "BuilderConfigureTableView",
      { pageRef: PAGE, kanban: { groupBy: "total" } },
      refused,
    );
    expect(result.isError).toBe(true);
  });
});

describe("BuilderMapResources", () => {
  const resource = {
    relation: "shop.orders",
    tableView: true,
    writable: false,
    icon: "i-ph-shopping-cart",
    description: "Every order.",
    order: 120,
    tabs: { column: "status" },
    fields: [
      {
        column: "status",
        filterable: true,
        display: {
          kind: "badge",
          items: [{ value: "paid", label: "Paid", tone: "success" }],
        },
      },
      { column: "total", display: { kind: "price", currency: "USD" } },
    ],
    tableOptions: { kanban: { groupBy: "status" } },
  };

  it("keeps the displays, tabs, page options and table options it was given", async () => {
    const { result, calls } = await callTool("BuilderMapResources", {
      module: "shop-tables",
      connection: "shop",
      resources: [resource],
    });
    expect(result.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      op: "MapResources",
      args: [
        { module: "shop-tables", connection: "shop", resources: [resource] },
      ],
    });
  });
});

describe("BuilderMapResources relation columns", () => {
  it("passes a null relation on, which keeps a foreign key column plain", async () => {
    const orders = {
      relation: "shop.orders",
      tableView: true,
      writable: false,
      fields: [{ column: "customer_id", relation: null }],
    };
    const { result, calls } = await callTool("BuilderMapResources", {
      module: "shop-tables",
      connection: "shop",
      resources: [orders],
    });
    expect(result.isError).toBeFalsy();
    expect(calls[0]).toEqual({
      op: "MapResources",
      args: [
        { module: "shop-tables", connection: "shop", resources: [orders] },
      ],
    });
  });
});

describe("BuilderCreatePage", () => {
  it("takes an order and an icon, so a dashboard sorts before the mapped tables", async () => {
    const page = {
      name: "dashboard",
      displayName: "Dashboard",
      category: "pages.shop",
      icon: "i-ph-chart-line",
      order: 0,
      description: "How the shop is doing.",
    };
    const { calls } = await callTool("BuilderCreatePage", page);
    expect(calls).toEqual([{ op: "CreatePage", args: [page] }]);
  });
});
