import { describe, expect, it } from "vitest";
import { resolveSkillSources } from "../../src/skills/resolve-sources.js";

const moduleDirs = [{ module: "dms-ai", dir: "/proj/dms-ai/skills" }];

describe("resolveSkillSources", () => {
  it("returns module dirs only when local is off", () => {
    expect(resolveSkillSources(moduleDirs, false, "/home/u")).toEqual(
      moduleDirs,
    );
  });
  it("appends the local dir tagged 'local' when on", () => {
    expect(resolveSkillSources(moduleDirs, true, "/home/u")).toEqual([
      ...moduleDirs,
      { module: "local", dir: "/home/u/.claude/skills" },
    ]);
  });
  it("dedupes if a module already declares the local path", () => {
    const dirs = [{ module: "x", dir: "/home/u/.claude/skills" }];
    expect(resolveSkillSources(dirs, true, "/home/u")).toEqual(dirs);
  });
});
