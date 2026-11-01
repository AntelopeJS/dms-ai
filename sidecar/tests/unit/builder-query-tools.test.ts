import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
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

const SERIES = {
  name: "revenue",
  resource: "order",
  template: "series",
  params: { op: "sum", field: "amount", groupBy: "createdAt", bucket: "month" },
};

interface Recorded {
  op: string;
  args: unknown[];
}

function startServer(gate?: BuilderGate) {
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
        return { ok: true, data: { body: { series: [] } }, changes: [] };
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

async function callTool(name: string, args: ToolArguments, gate?: BuilderGate) {
  const { server, calls } = startServer(gate);
  const result = await withClient(server, (client) =>
    client.callTool({ name, arguments: args }),
  );
  return { result, calls };
}

describe("BuilderAddQuery", () => {
  it("hands the Builder whether to compare the preceding period", async () => {
    const { calls } = await callTool("BuilderAddQuery", {
      page: "/dashboard",
      ...SERIES,
      response: "card",
      compare: true,
    });
    expect(calls).toEqual([
      {
        op: "AddQuery",
        args: ["/dashboard", { ...SERIES, response: "card", compare: true }],
      },
    ]);
  });

  it("refuses a compare that is not a boolean, without calling the Builder", async () => {
    const { result, calls } = await callTool("BuilderAddQuery", {
      page: "/dashboard",
      ...SERIES,
      compare: "yes",
    });
    expect(result.isError).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("BuilderConfigureQuery", () => {
  it("forwards a compare patch", async () => {
    const { calls } = await callTool("BuilderConfigureQuery", {
      query: "/dashboard@revenue",
      patch: { compare: false },
    });
    expect(calls).toEqual([
      {
        op: "ConfigureQuery",
        args: ["/dashboard@revenue", { compare: false }],
      },
    ]);
  });
});

describe("BuilderPreviewQuery", () => {
  it("runs the unsaved query with the arguments its route would receive and answers the Builder's result", async () => {
    const args = { from: "2026-01-01", to: "2026-01-31" };
    const { result, calls } = await callTool("BuilderPreviewQuery", {
      ...SERIES,
      response: "card",
      compare: true,
      args,
    });
    expect(calls).toEqual([
      {
        op: "PreviewQuery",
        args: [{ query: { ...SERIES, response: "card", compare: true }, args }],
      },
    ]);
    expect(JSON.stringify(result.content)).toContain("series");
  });

  it("needs no page, and sends no arguments when it is given none", async () => {
    const { calls } = await callTool("BuilderPreviewQuery", SERIES);
    expect(calls).toEqual([{ op: "PreviewQuery", args: [{ query: SERIES }] }]);
  });

  it("refuses a raw $expr value with the safe-mode refusal", async () => {
    const { result, calls } = await callTool("BuilderPreviewQuery", {
      ...SERIES,
      args: { from: { $expr: "x" } },
    });
    expect(calls).toEqual([]);
    expect(JSON.stringify(result.content)).toContain("unsupported");
  });

  it("is listed with the other Builder tools and takes the query fields but no page", async () => {
    const { server } = startServer();
    const { tools } = await withClient(server, (client) => client.listTools());
    const preview = tools.find((tool) => tool.name === "BuilderPreviewQuery");
    const add = tools.find((tool) => tool.name === "BuilderAddQuery");
    expect(Object.keys(preview?.inputSchema.properties ?? {}).sort()).toEqual(
      [
        "args",
        "compare",
        "endpoint",
        "name",
        "params",
        "resource",
        "response",
        "template",
      ].sort(),
    );
    expect(Object.keys(add?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["response", "compare"]),
    );
  });

  it("runs in plan mode and without an approval, and never waits at the mutation gate", async () => {
    const gate = vi.fn<BuilderGate>(async () => ({ isAllowed: false }));
    const { calls } = await callTool("BuilderPreviewQuery", SERIES, gate);
    expect(calls).toHaveLength(1);
    expect(gate).not.toHaveBeenCalled();
    expect(isReadOnlyTool("BuilderPreviewQuery")).toBe(true);
    expect(BUILDER_TOOL_NAMES).toContain("BuilderPreviewQuery");
    expect(BUILDER_MUTATING_TOOL_NAMES).not.toContain("BuilderPreviewQuery");
    expect(
      FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES.has(
        `${MCP_TOOL_NAME_PREFIX}BuilderPreviewQuery`,
      ),
    ).toBe(true);
  });
});
