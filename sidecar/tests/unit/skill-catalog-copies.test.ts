import { describe, expect, it } from "vitest";
import {
  type SkillCatalogItem,
  withoutIdenticalCopies,
} from "../../src/skills/build-catalog.js";

function item(
  provenance: string,
  name: string,
  body: string,
): SkillCatalogItem {
  return {
    id: `${provenance}:${name}`,
    name,
    description: "",
    tags: [],
    provenance,
    body,
  };
}

describe("withoutIdenticalCopies", () => {
  it("keeps the first of two word-for-word copies", () => {
    const items = withoutIdenticalCopies([
      item("antelopejs-dms", "dms-pages", "same"),
      item("dms", "dms-pages", "same"),
    ]);
    expect(items.map((entry) => entry.id)).toEqual([
      "antelopejs-dms:dms-pages",
    ]);
  });

  it("keeps two skills sharing a name with different bodies", () => {
    const items = withoutIdenticalCopies([
      item("@antelopejs/dms-mailing", "invoice-layout", "new"),
      item("local", "invoice-layout", "old"),
    ]);
    expect(items).toHaveLength(2);
  });
});
