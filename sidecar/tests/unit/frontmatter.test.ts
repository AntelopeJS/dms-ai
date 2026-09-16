import { describe, expect, it } from "vitest";
import { parseSkillFile } from "../../src/skills/frontmatter.js";

const SAMPLE = `---
name: page-builder
description: Create and modify DMS pages. Use when the user wants to add or edit a page.
icon: file
category: Builder
tags: [Pages, Layout]
---

Step 1. Do the thing.
`;

describe("parseSkillFile", () => {
  it("extracts display fields and body", () => {
    const r = parseSkillFile(SAMPLE);
    expect(r?.name).toBe("page-builder");
    expect(r?.description).toMatch(/Create and modify/);
    expect(r?.icon).toBe("file");
    expect(r?.category).toBe("Builder");
    expect(r?.tags).toEqual(["Pages", "Layout"]);
    expect(r?.body.trim()).toBe("Step 1. Do the thing.");
  });
  it("returns null for a file without frontmatter", () => {
    expect(parseSkillFile("no front matter here")).toBeNull();
  });
  it("requires name and description", () => {
    expect(parseSkillFile(`---\nname: x\n---\nbody`)).toBeNull();
  });
  it("defaults optional fields", () => {
    const r = parseSkillFile(`---\nname: x\ndescription: d\n---\nb`);
    expect(r?.tags).toEqual([]);
    expect(r?.icon).toBeUndefined();
  });
});
