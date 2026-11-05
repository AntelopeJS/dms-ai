import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ANALYST_DATASET_ROW_CAP } from "../../src/constants/analyst.js";
import { createAnalystMcpServer } from "../../src/mcp/sdk-binding.js";
import type { AiMcpServerDeps } from "../../src/mcp/types.js";
import { createMcpServerCache } from "../../src/server/mcp-server-cache.js";
import {
  analystDeps,
  type Call,
  callTool,
  GRANT,
  rowsClient,
  withClient,
} from "../helpers/analyst-server.js";

const LIMIT_TEST_TIMEOUT_MS = 30_000;
const STATUSES = ["open", "paid", "void"];

function orderAt(index: number) {
  return {
    _id: `order-${index}`,
    status: STATUSES[index % STATUSES.length] ?? "open",
    amount: index,
  };
}

const LoadSummarySchema = z.strictObject({
  name: z.string(),
  rowCount: z.number(),
  total: z.number(),
  isPartial: z.boolean(),
  columns: z.array(z.string()),
  samples: z.array(z.record(z.string(), z.json())),
});
const ComputedSchema = z.object({ result: z.json() });
const FailureSchema = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), detail: z.string() }),
});

async function load(client: Client, name = "orders") {
  return callTool(client, "AnalystLoad", {
    name,
    page: "/sales",
    table: "orders",
  });
}

async function compute(client: Client, code: string) {
  return callTool(client, "AnalystCompute", { code });
}

async function computed(client: Client, code: string) {
  const answer = await compute(client, code);
  expect(answer.isError).toBe(false);
  return ComputedSchema.parse(answer.body).result;
}

async function failed(client: Client, code: string) {
  const answer = await compute(client, code);
  expect(answer.isError).toBe(true);
  return FailureSchema.parse(answer.body).error.detail;
}

function withOrders<T>(
  total: number,
  use: (client: Client, calls: Call[]) => Promise<T>,
  options: Parameters<typeof analystDeps>[1] = {},
): Promise<T> {
  const calls: Call[] = [];
  const deps: AiMcpServerDeps = analystDeps(
    rowsClient(total, calls, orderAt),
    options,
  );
  return withClient(createAnalystMcpServer(deps), (client) =>
    use(client, calls),
  );
}

describe("AnalystLoad", () => {
  it("answers a summary with three sample rows, never the rows themselves", async () => {
    await withOrders(250, async (client) => {
      const answer = await load(client);
      const summary = LoadSummarySchema.parse(answer.body);
      expect(summary).toMatchObject({
        name: "orders",
        rowCount: 250,
        total: 250,
        isPartial: false,
        columns: ["_id", "status", "amount"],
      });
      expect(summary.samples).toHaveLength(3);
      expect(answer.text).not.toContain("order-249");
    });
  });

  it("pages past a thousand rows, a hundred at a time, with the turn's grant", async () => {
    await withOrders(2_500, async (client, calls) => {
      const summary = LoadSummarySchema.parse((await load(client)).body);
      expect(summary.rowCount).toBe(2_500);
      expect(calls).toHaveLength(25);
      expect(calls.every((call) => call.query.get("limit") === "100")).toBe(
        true,
      );
      expect(new Set(calls.map((call) => call.grant))).toEqual(
        new Set([GRANT]),
      );
    });
  });

  it("stops at the conversation's cap, says the load is partial and refuses another dataset past it", async () => {
    await withOrders(ANALYST_DATASET_ROW_CAP + 500, async (client) => {
      const first = LoadSummarySchema.parse((await load(client)).body);
      expect(first.rowCount).toBe(ANALYST_DATASET_ROW_CAP);
      expect(first.isPartial).toBe(true);
      const second = await load(client, "more");
      expect(FailureSchema.parse(second.body).error.code).toBe("dataset_cap");
      const replaced = await callTool(client, "AnalystLoad", {
        name: "orders",
        page: "/sales",
        table: "orders",
        limit: 10,
      });
      expect(LoadSummarySchema.parse(replaced.body).rowCount).toBe(10);
      expect(await computed(client, "return orders.length")).toBe(10);
    });
  });

  it("reads and keeps nothing without a signed-in user", async () => {
    await withOrders(
      10,
      async (client, calls) => {
        expect((await load(client)).isError).toBe(true);
        expect(calls).toEqual([]);
        expect((await compute(client, "return 1")).isError).toBe(true);
      },
      { grant: null },
    );
  });

  it.each(["datasets", "class", "Orders", "_x", "a-b"])(
    "refuses the dataset name %s",
    async (name) => {
      await withOrders(10, async (client, calls) => {
        expect((await load(client, name)).isError).toBe(true);
        expect(calls).toEqual([]);
      });
    },
  );
});

describe("AnalystCompute", () => {
  it("groups and sums a loaded dataset larger than one read", async () => {
    await withOrders(1_500, async (client) => {
      await load(client);
      const result = await computed(
        client,
        `const sums = {};
         for (const row of orders) sums[row.status] = (sums[row.status] ?? 0) + row.amount;
         return { sums, viaDatasets: datasets.orders.length };`,
      );
      const expected = new Map<string, number>();
      for (let i = 0; i < 1_500; i += 1) {
        const { status, amount } = orderAt(i);
        expected.set(status, (expected.get(status) ?? 0) + amount);
      }
      expect(result).toEqual({
        sums: Object.fromEntries(expected),
        viaDatasets: 1_500,
      });
    });
  });

  it("starts every run from a fresh copy of the datasets", async () => {
    await withOrders(20, async (client) => {
      await load(client);
      await computed(
        client,
        "orders.length = 0; globalThis.leak = 1; return 0",
      );
      expect(
        await computed(client, "return [orders.length, typeof leak]"),
      ).toEqual([20, "undefined"]);
    });
  });

  it("does not see another conversation's datasets", async () => {
    const calls: Call[] = [];
    const client = rowsClient(20, calls, orderAt);
    const serverOf = (conversationId: string) =>
      createAnalystMcpServer(analystDeps(client, { conversationId }));
    await withClient(serverOf("conv-a"), (a) => load(a));
    const seen = await withClient(serverOf("conv-b"), (b) =>
      computed(b, "return [typeof orders, Object.keys(datasets)]"),
    );
    expect(seen).toEqual(["undefined", []]);
  });

  it("drops a conversation's datasets when the conversation is forgotten", async () => {
    const servers = createMcpServerCache(
      (conversationId) =>
        analystDeps(rowsClient(20, [], orderAt), { conversationId }),
      createAnalystMcpServer,
    );
    await withClient(servers.get("conv-a"), (client) => load(client));
    servers.forget("conv-a");
    const seen = await withClient(servers.get("conv-a"), (client) =>
      computed(client, "return Object.keys(datasets)"),
    );
    expect(seen).toEqual([]);
  });

  it.each([
    ["require", "return require('node:fs')", /'require' is not defined/],
    ["process", "return process.env", /'process' is not defined/],
    [
      "fetch",
      "return await globalThis.fetch('http://127.0.0.1/')",
      /not a function/,
    ],
    ["import()", "return await import('node:fs')", /could not load module/],
    ["timers", "return setTimeout(() => {}, 0)", /'setTimeout' is not defined/],
    ["console", "console.log('x'); return 1", /'console' is not defined/],
    [
      "the host through Function",
      "return Function('return process')()",
      /'process' is not defined/,
    ],
  ])("cannot reach %s", async (_reach, code, refusal) => {
    await withOrders(0, async (client) => {
      expect(await failed(client, code)).toMatch(refusal);
    });
  });

  it("offers no global beyond the language's own and the datasets", async () => {
    await withOrders(0, async (client) => {
      const names = z
        .array(z.string())
        .parse(
          await computed(
            client,
            "return Object.getOwnPropertyNames(globalThis)",
          ),
        );
      for (const host of [
        "process",
        "require",
        "module",
        "Buffer",
        "fetch",
        "setTimeout",
        "setInterval",
        "queueMicrotask",
        "console",
        "WebAssembly",
        "XMLHttpRequest",
        "Deno",
        "Bun",
      ]) {
        expect(names).not.toContain(host);
      }
    });
  });

  it(
    "stops an endless loop at the time limit",
    async () => {
      await withOrders(0, async (client) => {
        const started = Date.now();
        expect(await failed(client, "while (true) {}")).toMatch(/longer than/);
        expect(Date.now() - started).toBeLessThan(15_000);
      });
    },
    LIMIT_TEST_TIMEOUT_MS,
  );

  it(
    "stops a huge allocation at the memory limit",
    async () => {
      await withOrders(0, async (client) => {
        expect(
          await failed(
            client,
            "const all = []; while (true) all.push(new Array(1e6).fill(1));",
          ),
        ).toMatch(/more than \d+ MB/);
      });
    },
    LIMIT_TEST_TIMEOUT_MS,
  );

  it("stops runaway recursion inside the sandbox", async () => {
    await withOrders(0, async (client) => {
      expect(
        await failed(client, "function f() { return f() + 1 } return f()"),
      ).toMatch(/stack overflow/);
    });
  });

  it("refuses an oversized result and asks for more aggregation", async () => {
    await withOrders(0, async (client) => {
      expect(await failed(client, "return 'x'.repeat(30000)")).toMatch(
        /aggregate further/,
      );
    });
  });

  it("answers a syntax error as a tool error", async () => {
    await withOrders(0, async (client) => {
      expect(await failed(client, "return (")).toMatch(/SyntaxError/);
    });
  });

  it("asks for a return when the script returns nothing", async () => {
    await withOrders(0, async (client) => {
      expect(await failed(client, "const x = 1;")).toMatch(/return/);
    });
  });
});
