import { describe, expect, it } from "vitest";
import { parseSkillDirs } from "../../src/index.js";

describe("parseSkillDirs", () => {
  it("parses a valid JSON array of skill sources", () => {
    const json = JSON.stringify([{ module: "dms-ai", dir: "/abs/skills" }]);
    expect(parseSkillDirs(json)).toEqual([
      { module: "dms-ai", dir: "/abs/skills" },
    ]);
  });
  it("drops malformed entries", () => {
    const json = JSON.stringify([
      { module: "x", dir: "/d" },
      { dir: "/nodir" },
      5,
      null,
    ]);
    expect(parseSkillDirs(json)).toEqual([{ module: "x", dir: "/d" }]);
  });
  it("degrades to [] on invalid JSON", () => {
    expect(parseSkillDirs("not json")).toEqual([]);
  });
});
