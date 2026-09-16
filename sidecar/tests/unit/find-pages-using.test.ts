import { describe, expect, it } from "vitest";
import { computeCandidates } from "../../src/mcp/tools/find-pages-using.js";
import type { ScanResult } from "../../src/pages/imports-scanner.js";
import type { PagesRegistryEntry } from "../../src/pages/types.js";

const ROOT = "/tmp/host";

function abs(rel: string): string {
  return `${ROOT}/${rel}`;
}

function buildPages(): PagesRegistryEntry[] {
  return [
    {
      id: "home",
      path: "/",
      filepath: "pages/Home.vue",
      moduleId: "dms",
    },
    {
      id: "about",
      path: "/about",
      filepath: "pages/About.vue",
      moduleId: "dms",
    },
    {
      id: "contact",
      path: "/contact",
      filepath: "pages/Contact.vue",
      moduleId: "dms",
    },
  ];
}

function buildScan(extra?: Map<string, string[]>): ScanResult {
  const importersByFile = new Map<string, string[]>();
  importersByFile.set(abs("components/Button.vue"), [
    abs("pages/Home.vue"),
    abs("pages/About.vue"),
  ]);
  if (extra !== undefined) {
    for (const [k, v] of extra.entries()) {
      importersByFile.set(k, v);
    }
  }
  return { importersByFile };
}

describe("computeCandidates", () => {
  it("returns distance 0 when filepath IS a registered page", () => {
    const candidates = computeCandidates(
      "pages/Home.vue",
      buildPages(),
      buildScan(),
      ROOT,
      { path: "/somewhere" },
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.pagePath).toBe("/");
    expect(candidates[0]?.distance).toBe(0);
  });

  it("returns the pages that import a shared component", () => {
    const candidates = computeCandidates(
      "components/Button.vue",
      buildPages(),
      buildScan(),
      ROOT,
      { path: "/somewhere" },
    );
    expect(candidates).toHaveLength(2);
    const paths = candidates.map((c) => c.pagePath).sort();
    expect(paths).toEqual(["/", "/about"]);
    for (const c of candidates) {
      expect(c.distance).toBe(1);
    }
  });

  it("ranks the current page first", () => {
    const candidates = computeCandidates(
      "components/Button.vue",
      buildPages(),
      buildScan(),
      ROOT,
      { path: "/about" },
    );
    expect(candidates[0]?.pagePath).toBe("/about");
  });

  it("traverses transitive imports up to MAX_BFS_DEPTH", () => {
    const innerHelper = abs("lib/inner.ts");
    const midHelper = abs("lib/mid.ts");
    const extra = new Map<string, string[]>();
    extra.set(innerHelper, [midHelper]);
    extra.set(midHelper, [abs("pages/Contact.vue")]);
    const candidates = computeCandidates(
      "lib/inner.ts",
      buildPages(),
      buildScan(extra),
      ROOT,
      { path: "/" },
    );
    const contact = candidates.find((c) => c.pagePath === "/contact");
    expect(contact).toBeDefined();
    expect(contact?.distance).toBe(2);
  });

  it("returns an empty list when filepath is unknown", () => {
    const candidates = computeCandidates(
      "unknown/file.ts",
      buildPages(),
      buildScan(),
      ROOT,
      { path: "/" },
    );
    expect(candidates).toEqual([]);
  });
});
