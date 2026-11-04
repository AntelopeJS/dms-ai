import { describe, expect, it, vi } from "vitest";
import {
  LIST_PAGES_EMPTY_MESSAGE,
  LIST_PAGES_ERROR_MESSAGE,
  LIST_PAGES_TOOL_NAME,
} from "../../src/constants/pages.js";
import { buildListPagesTool } from "../../src/mcp/tools/list-pages.js";
import type { RegistryClient } from "../../src/pages/registry-client.js";
import type { PagesRegistryEntry } from "../../src/pages/types.js";

function buildRegistry(
  entries: PagesRegistryEntry[],
  overrides: Partial<RegistryClient> = {},
): RegistryClient {
  return {
    getRegistry: async () => entries,
    getStaleSinceMs: () => null,
    invalidate: () => {},
    ...overrides,
  };
}

function buildTool(registry: RegistryClient) {
  return buildListPagesTool({ registry });
}

describe("buildListPagesTool", () => {
  it("registers under the list_pages name", () => {
    expect(buildTool(buildRegistry([])).name).toBe(LIST_PAGES_TOOL_NAME);
  });

  it("returns the registry pages as {id, path, moduleId} JSON", async () => {
    const registry = buildRegistry([
      { id: "p1", path: "/form/form-simple", moduleId: "dms" },
    ]);
    const result = await buildTool(registry).handler({ refresh: undefined });
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? "[]");
    expect(parsed).toEqual([
      { id: "p1", path: "/form/form-simple", moduleId: "dms" },
    ]);
  });

  it("reports when no pages are registered", async () => {
    const result = await buildTool(buildRegistry([])).handler({
      refresh: undefined,
    });
    expect(result.content[0]?.text).toBe(LIST_PAGES_EMPTY_MESSAGE);
  });

  it("invalidates the cache when refresh is requested", async () => {
    const invalidate = vi.fn();
    const registry = buildRegistry(
      [{ id: "p1", path: "/x", moduleId: "dms" }],
      { invalidate },
    );
    await buildTool(registry).handler({ refresh: true });
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("returns an error message when the registry fetch throws", async () => {
    const registry = buildRegistry([], {
      getRegistry: async () => {
        throw new Error("backend down");
      },
    });
    const result = await buildTool(registry).handler({ refresh: undefined });
    expect(result.content[0]?.text).toBe(LIST_PAGES_ERROR_MESSAGE);
  });
});
