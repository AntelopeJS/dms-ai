import path from "node:path";
import type { SkillSource } from "./types.js";

export const LOCAL_SKILLS_PROVENANCE = "local";

// The final set of skill dirs the agent loads and the catalog scans: the
// module-contributed dirs plus the machine-local `~/.claude/skills` dir, the
// latter only when `allowLocalSkills` is on and not already declared by a module.
export function resolveSkillSources(
  moduleDirs: readonly SkillSource[],
  allowLocalSkills: boolean,
  homeDir: string,
): SkillSource[] {
  const out = [...moduleDirs];
  if (!allowLocalSkills) return out;
  const localDir = path.join(homeDir, ".claude", "skills");
  if (out.some((s) => path.resolve(s.dir) === path.resolve(localDir))) {
    return out;
  }
  out.push({ module: LOCAL_SKILLS_PROVENANCE, dir: localDir });
  return out;
}
