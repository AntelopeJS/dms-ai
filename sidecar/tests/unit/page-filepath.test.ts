import { describe, expect, it } from "vitest";
import { createPageFilepathResolver } from "../../src/pages/page-filepath.js";
import type { RegistryClient } from "../../src/pages/registry-client.js";
import type { PagesRegistryEntry } from "../../src/pages/types.js";

const PROJECT_ROOT = "/project";

const ENTRIES: PagesRegistryEntry[] = [
  {
    id: "orders",
    path: "/modules/shop/orders",
    filepath: "src/pages/orders.ts",
    moduleId: "shop",
  },
  { id: "home", path: "/", moduleId: "app" },
];

function registryOf(read: () => Promise<PagesRegistryEntry[]>): RegistryClient {
  return {
    getRegistry: read,
    getStaleSinceMs: () => null,
    invalidate: () => {},
  };
}

describe("createPageFilepathResolver", () => {
  const resolve = createPageFilepathResolver(
    registryOf(async () => ENTRIES),
    PROJECT_ROOT,
  );

  it("maps a route to its page file, anchored at the project root", async () => {
    expect(await resolve("/modules/shop/orders/")).toBe(
      "/project/src/pages/orders.ts",
    );
  });

  it("resolves nothing for an unregistered route or a page without a file", async () => {
    expect(await resolve("/nowhere")).toBeUndefined();
    expect(await resolve("/")).toBeUndefined();
  });

  it("resolves nothing when the registry cannot be reached", async () => {
    const unreachable = createPageFilepathResolver(
      registryOf(async () => {
        throw new Error("backend down");
      }),
      PROJECT_ROOT,
    );
    expect(await unreachable("/modules/shop/orders")).toBeUndefined();
  });
});
