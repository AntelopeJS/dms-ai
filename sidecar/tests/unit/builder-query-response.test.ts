import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AnyMcpToolDefinition } from "../../src/mcp/define-tool.js";
import { buildBuilderTools } from "../../src/mcp/tools/builder.js";

const builderClient = { call: vi.fn(async () => ({ ok: true })) };

/** The arguments these tests send the query tools, valid or not. */
interface QueryToolArgs {
  page?: string;
  name?: string;
  resource?: string;
  template?: string;
  params?: { groupBy: string };
  response?: string;
  query?: string;
  patch?: { response: string };
}

/** Calls a tool the way an MCP binding does: arguments parsed by its schema first. */
async function callTool(name: string, args: QueryToolArgs) {
  const tools: AnyMcpToolDefinition[] = buildBuilderTools({
    builderClient,
    gate: async () => ({ isAllowed: true }),
  });
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  await tool.handler(z.object(tool.schema).parse(args));
}

describe("the arrangement a query's route answers in", () => {
  it("reaches the Builder when a query is added for a ranked list", async () => {
    builderClient.call.mockClear();
    await callTool("BuilderAddQuery", {
      page: "/shop/stats",
      name: "ordersByStatus",
      resource: "shop/orders",
      template: "series",
      params: { groupBy: "status" },
      response: "items",
    });
    expect(builderClient.call).toHaveBeenCalledWith("AddQuery", [
      "/shop/stats",
      expect.objectContaining({ response: "items" }),
    ]);
  });

  it("reaches the Builder when a query is reconfigured for a chart card", async () => {
    builderClient.call.mockClear();
    await callTool("BuilderConfigureQuery", {
      query: "/shop/stats@ordersByMonth",
      patch: { response: "card" },
    });
    expect(builderClient.call).toHaveBeenCalledWith("ConfigureQuery", [
      "/shop/stats@ordersByMonth",
      { response: "card" },
    ]);
  });

  it("refuses an arrangement the Builder has no helper for", () => {
    return expect(
      callTool("BuilderAddQuery", {
        page: "/shop/stats",
        name: "orders",
        resource: "shop/orders",
        template: "series",
        response: "table",
      }),
    ).rejects.toThrow();
  });
});
