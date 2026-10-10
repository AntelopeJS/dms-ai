import { describe, expect, it, vi } from "vitest";
import type { AnyMcpToolDefinition } from "../../src/mcp/define-tool.js";
import { shapeCatalog } from "../../src/mcp/tools/builder-catalog.js";
import { buildBuilderTools } from "../../src/mcp/tools/builder.js";

const TABLE_VIEW = {
  type: "TableView",
  import: { name: "TableView", module: "@antelopejs/interface-dms/base" },
  label: "Table view",
  group: "data",
  container: false,
  controllerArg: true,
  description: "Paginated table over a resource, with its forms and actions.",
  config: { columns: { type: "array" }, rowActions: { type: "array" } },
  shapeSource: "annotated",
};

const GRID = {
  type: "Grid",
  import: { name: "Grid" },
  label: "Grid",
  group: "layout",
  container: true,
  description: "Responsive grid container laid out in rows.",
  config: { gap: { type: "number" } },
  shapeSource: "annotated",
};

const SELECT = {
  id: "select",
  import: { name: "SelectType" },
  config: { options: { type: "array" }, multiple: { type: "boolean" } },
};

const CATALOG = {
  blocks: [TABLE_VIEW, GRID],
  dataTypes: [SELECT],
  reservedFieldNames: ["_id", "count"],
  generatedAt: "2026-10-07T15:52:01.975Z",
};

const NO_SELECTION = { blocks: undefined, dataTypes: undefined };

describe("BuilderCatalog shaping", () => {
  it("answers a compact index by default", () => {
    expect(shapeCatalog(CATALOG, NO_SELECTION)).toMatchObject({
      blocks: [
        {
          type: "TableView",
          description: TABLE_VIEW.description,
          group: "data",
          container: false,
          controllerArg: true,
        },
        {
          type: "Grid",
          description: GRID.description,
          container: true,
        },
      ],
      dataTypes: [{ id: "select", configKeys: ["options", "multiple"] }],
      reservedFieldNames: ["_id", "count"],
      generatedAt: CATALOG.generatedAt,
    });
  });

  it("keeps config schemas out of the index", () => {
    const index = JSON.stringify(shapeCatalog(CATALOG, NO_SELECTION));
    expect(index).not.toContain("rowActions");
    expect(index).not.toContain("shapeSource");
  });

  it("answers the full schema of only the named entries", () => {
    expect(
      shapeCatalog(CATALOG, { blocks: ["Grid"], dataTypes: undefined }),
    ).toEqual({ blocks: [GRID] });
    expect(
      shapeCatalog(CATALOG, { blocks: ["TableView"], dataTypes: ["select"] }),
    ).toEqual({ blocks: [TABLE_VIEW], dataTypes: [SELECT] });
  });

  it("names the entries the catalog does not have", () => {
    expect(
      shapeCatalog(CATALOG, { blocks: ["Grid", "Tree"], dataTypes: ["money"] }),
    ).toEqual({
      blocks: [GRID],
      unknownBlocks: ["Tree"],
      dataTypes: [],
      unknownDataTypes: ["money"],
    });
  });

  it("passes a failed answer through untouched", () => {
    const failure = { ok: false, error: { code: "request_failed" } };
    expect(shapeCatalog(failure, NO_SELECTION)).toBe(failure);
  });
});

describe("Builder tool results", () => {
  function tool(name: string, answer: unknown): AnyMcpToolDefinition {
    const builderClient = { call: vi.fn(async () => answer) };
    const found = buildBuilderTools({ builderClient }).find(
      (t) => t.name === name,
    );
    if (found === undefined) throw new Error(`no tool ${name}`);
    return found;
  }

  it("serves the catalog index through the tool", async () => {
    const result = await tool("BuilderCatalog", CATALOG).handler(
      NO_SELECTION,
      {},
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(JSON.parse(text).blocks[0]).not.toHaveProperty("config");
  });

  it("marks an ok:false answer as a failed call", async () => {
    const failure = { ok: false, error: { code: "typecheck_failed" } };
    const result = await tool("BuilderAddBlock", failure).handler(
      { page: "/p", name: "kpi", type: "KpiCard", config: {} },
      {},
    );
    expect(result).toMatchObject({
      isError: true,
      content: [{ text: JSON.stringify(failure) }],
    });
  });

  it("leaves a successful answer unmarked", async () => {
    const result = await tool("BuilderAddBlock", { ok: true }).handler(
      { page: "/p", name: "kpi", type: "KpiCard", config: {} },
      {},
    );
    expect(result.isError).toBeUndefined();
  });

  it("marks a refused $expr as a failed call", async () => {
    const result = await tool("BuilderAddBlock", { ok: true }).handler(
      {
        page: "/p",
        name: "kpi",
        type: "KpiCard",
        config: { value: { $expr: "x" } },
      },
      {},
    );
    expect(result.isError).toBe(true);
  });
});
