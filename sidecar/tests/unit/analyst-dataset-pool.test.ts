import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type AnalystRow,
  createAnalystDatasetPool,
  createAnalystDatasets,
} from "../../src/analyst/datasets.js";
import type { AnalystClient } from "../../src/analyst/analyst-client.js";
import { buildAnalystDatasetTools } from "../../src/mcp/tools/analyst-datasets.js";

const CONVERSATION_CAP = 10;

function rows(count: number): AnalystRow[] {
  return Array.from({ length: count }, (_, i) => ({ _id: String(i) }));
}

describe("the sidecar's dataset budget", () => {
  it("keeps every conversation together within the budget, however many conversations load", () => {
    const pool = createAnalystDatasetPool(12);
    const conversations = Array.from({ length: 5 }, () =>
      createAnalystDatasets(CONVERSATION_CAP, pool),
    );
    for (const datasets of conversations) datasets.put("orders", rows(5));
    expect(pool.held()).toBeLessThanOrEqual(12);
    expect(conversations.at(-1)?.all().get("orders")).toHaveLength(5);
  });

  it("evicts the dataset used least recently and names it to its conversation", () => {
    const pool = createAnalystDatasetPool(10);
    const first = createAnalystDatasets(CONVERSATION_CAP, pool);
    const second = createAnalystDatasets(CONVERSATION_CAP, pool);
    first.put("orders", rows(4));
    second.put("orders", rows(4));
    first.all();
    second.put("customers", rows(4));
    expect([...first.all().keys()]).toEqual(["orders"]);
    expect([...second.all().keys()]).toEqual(["customers"]);
    expect(second.evicted()).toEqual(["orders"]);
    expect(first.evicted()).toEqual([]);
  });

  it("forgets an eviction once the dataset is loaded again", () => {
    const pool = createAnalystDatasetPool(6);
    const datasets = createAnalystDatasets(CONVERSATION_CAP, pool);
    datasets.put("orders", rows(4));
    datasets.put("customers", rows(4));
    expect(datasets.evicted()).toEqual(["orders"]);
    datasets.put("orders", rows(2));
    expect(datasets.evicted()).toEqual([]);
  });

  it("tells a script that fails on an evicted dataset to load it again", async () => {
    const pool = createAnalystDatasetPool(4);
    const evicting = createAnalystDatasets(CONVERSATION_CAP, pool);
    const datasets = createAnalystDatasets(CONVERSATION_CAP, pool);
    datasets.put("orders", rows(4));
    evicting.put("other", rows(4));
    const client: AnalystClient = { get: async () => ({}) };
    const tools = buildAnalystDatasetTools(client, datasets, (read) =>
      read("grant").then((value) => ({
        content: [{ type: "text" as const, text: JSON.stringify(value) }],
      })),
    );
    const compute = tools.find((tool) => tool.name === "AnalystCompute");
    const answer = await compute?.handler({ code: "return orders.length;" });
    expect(answer?.content[0]?.text).toContain("loaded again: orders");
  });

  it("names an evicted dataset even when the script succeeds without it", async () => {
    const pool = createAnalystDatasetPool(4);
    const evicting = createAnalystDatasets(CONVERSATION_CAP, pool);
    const datasets = createAnalystDatasets(CONVERSATION_CAP, pool);
    datasets.put("orders", rows(4));
    evicting.put("other", rows(4));
    const client: AnalystClient = { get: async () => ({}) };
    const tools = buildAnalystDatasetTools(client, datasets, (read) =>
      read("grant").then((value) => ({
        content: [{ type: "text" as const, text: JSON.stringify(value) }],
      })),
    );
    const compute = tools.find((tool) => tool.name === "AnalystCompute");
    const answer = await compute?.handler({
      code: "return (datasets.orders ?? []).length;",
    });
    const body = z
      .strictObject({
        result: z.number(),
        evicted: z.array(z.string()),
        warning: z.string(),
      })
      .parse(JSON.parse(answer?.content[0]?.text ?? "{}"));
    expect(body.result).toBe(0);
    expect(body.evicted).toEqual(["orders"]);
    expect(body.warning).toContain("loaded again");
  });
});
