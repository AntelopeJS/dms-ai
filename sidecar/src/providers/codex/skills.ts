import path from "node:path";
import { CODEX_OWNED_SKILL_SCOPES } from "../../constants/codex.js";
import type { SkillSource } from "../../skills/types.js";
import type { v2 } from "./protocol/index.js";

export interface SkillNeutralizationInput {
  extraRoots: readonly string[];
  allowLocalSkills: boolean;
}

/**
 * Directories handed to `skills/extraRoots/set`. Deduplicated because two
 * modules may legitimately contribute the same directory.
 */
export function buildSkillExtraRoots(
  sources: readonly SkillSource[],
): string[] {
  const seen = new Set<string>();
  for (const source of sources) seen.add(path.resolve(source.dir));
  return [...seen];
}

export function collectListedSkills(
  entries: readonly v2.SkillsListEntry[],
): v2.SkillMetadata[] {
  return entries.flatMap((entry) => entry.skills);
}

function isUnderRoot(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  if (relative === "") return true;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isContributedByUs(
  skill: v2.SkillMetadata,
  extraRoots: readonly string[],
): boolean {
  const resolved = path.resolve(skill.path);
  return extraRoots.some((root) => isUnderRoot(resolved, path.resolve(root)));
}

function mustDisable(
  skill: v2.SkillMetadata,
  input: SkillNeutralizationInput,
): boolean {
  if (!skill.enabled) return false;
  if (isContributedByUs(skill, input.extraRoots)) return false;
  if (CODEX_OWNED_SKILL_SCOPES.includes(skill.scope)) return true;
  return !input.allowLocalSkills;
}

/**
 * Skills to switch off before the first turn. Codex scans `$CWD/.agents/skills`
 * and its own system scope natively, and neither an isolated CODEX_HOME nor a
 * dedicated HOME hides those — only a per-path disable does. Without this the
 * `allowLocalSkills` setting would be a lie on the Codex path.
 */
export function selectSkillsToDisable(
  entries: readonly v2.SkillsListEntry[],
  input: SkillNeutralizationInput,
): v2.SkillsConfigWriteParams[] {
  return collectListedSkills(entries)
    .filter((skill) => mustDisable(skill, input))
    .map((skill) => ({ path: skill.path, enabled: false }));
}

/** Required skill names absent from, or disabled in, the Codex index. */
export function findMissingSkills(
  entries: readonly v2.SkillsListEntry[],
  requiredNames: readonly string[],
): string[] {
  const present = new Set(
    collectListedSkills(entries)
      .filter((skill) => skill.enabled)
      .map((skill) => skill.name),
  );
  return requiredNames.filter((name) => !present.has(name));
}
