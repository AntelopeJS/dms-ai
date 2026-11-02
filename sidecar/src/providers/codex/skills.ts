import path from "node:path";
import { z } from "zod";
import {
  CODEX_OWNED_SKILL_SCOPES,
  SAFE_MODE_SKILL_NAME,
} from "../../constants/codex.js";
import type { SkillSource } from "../../skills/types.js";
import type { v2 } from "./protocol/index.js";

const listedSkillSchema = z.object({
  name: z.string(),
  path: z.string(),
  scope: z.string(),
  enabled: z.boolean(),
});

const listedSkillsEntrySchema = z.object({
  skills: z.array(listedSkillSchema),
});

export type ListedSkill = z.output<typeof listedSkillSchema>;
export type ListedSkillsEntry = z.output<typeof listedSkillsEntrySchema>;

export const skillsListResponseSchema = z.object({
  data: z.array(listedSkillsEntrySchema),
});

export const threadStartResponseSchema = z.object({
  thread: z.object({ id: z.string() }),
});

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

function collectListedSkills(
  entries: readonly ListedSkillsEntry[],
): ListedSkill[] {
  return entries.flatMap((entry) => entry.skills);
}

function isUnderRoot(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  if (relative === "") return true;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isContributedByUs(
  skill: ListedSkill,
  extraRoots: readonly string[],
): boolean {
  const resolved = path.resolve(skill.path);
  return extraRoots.some((root) => isUnderRoot(resolved, path.resolve(root)));
}

function mustDisable(
  skill: ListedSkill,
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
  entries: readonly ListedSkillsEntry[],
  input: SkillNeutralizationInput,
): v2.SkillsConfigWriteParams[] {
  return collectListedSkills(entries)
    .filter((skill) => mustDisable(skill, input))
    .map((skill) => ({ path: skill.path, enabled: false }));
}

/** Required skill names absent from, or disabled in, the Codex index. */
export function findMissingSkills(
  entries: readonly ListedSkillsEntry[],
  requiredNames: readonly string[],
): string[] {
  const present = new Set(
    collectListedSkills(entries)
      .filter((skill) => skill.enabled)
      .map((skill) => skill.name),
  );
  return requiredNames.filter((name) => !present.has(name));
}

/** Whether the skill the safe-mode prompt relies on is enabled in the index. */
export function isSafeModeSkillIndexed(
  entries: readonly ListedSkillsEntry[],
): boolean {
  return findMissingSkills(entries, [SAFE_MODE_SKILL_NAME]).length === 0;
}
