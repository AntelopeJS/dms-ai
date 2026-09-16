import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSkillCatalog } from "../../src/skills/build-catalog.js";

const fixtureDir = path.join(__dirname, "../fixtures/skills/dms-ai");

describe("buildSkillCatalog", () => {
  it("lists parsed skills with provenance and namespaced id", async () => {
    const { items } = await buildSkillCatalog([
      { module: "dms-ai", dir: fixtureDir },
    ]);
    const pb = items.find((i) => i.name === "page-builder");
    expect(pb).toBeDefined();
    expect(pb?.id).toBe("dms-ai:page-builder");
    expect(pb?.provenance).toBe("dms-ai");
    expect(pb?.body.length).toBeGreaterThan(0);
  });
  it("skips dirs without SKILL.md and missing dirs", async () => {
    const { items } = await buildSkillCatalog([
      { module: "ghost", dir: "/does/not/exist" },
    ]);
    expect(items).toEqual([]);
  });
});
