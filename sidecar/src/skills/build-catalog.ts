import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseSkillFile } from "./frontmatter.js";
import type { SkillSource } from "./types.js";

export interface SkillCatalogItem {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category?: string;
  tags: string[];
  provenance: string;
  body: string;
}

export interface SkillCatalog {
  items: SkillCatalogItem[];
  // Names contributed by more than one module. Claude namespaces skills per
  // plugin, so a collision is harmless there; Codex keys them by bare name and
  // keeps only one, so the loser silently disappears from the agent's index.
  duplicateNames: string[];
}

async function scanDir(src: SkillSource): Promise<SkillCatalogItem[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(src.dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const items: SkillCatalogItem[] = [];
  for (const e of entries) {
    // Accept symlinked skill dirs too: `~/.claude/skills` entries are commonly
    // symlinks (e.g. into a shared `~/.agents/skills`), and `withFileTypes`
    // reports those as symlinks, NOT directories. A bad target just fails the
    // SKILL.md read below and is skipped.
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const file = path.join(src.dir, e.name, "SKILL.md");
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const parsed = parseSkillFile(raw);
    if (parsed === null) continue;
    // The id is `module:name` — the SAME string the loader's `skills` allowlist
    // needs (`plugin:skill`, plugin name = module). Keep these in lockstep.
    items.push({
      id: `${src.module}:${parsed.name}`,
      provenance: src.module,
      ...parsed,
    });
  }
  return items;
}

export function findDuplicateSkillNames(
  items: readonly SkillCatalogItem[],
): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const item of items) {
    if (seen.has(item.name)) duplicated.add(item.name);
    seen.add(item.name);
  }
  return [...duplicated];
}

function sameSkillKey(item: SkillCatalogItem): string {
  return `${item.name}\u0000${item.body}`;
}

/**
 * Drops the copies of a skill that another source already declared word for
 * word: a package installed both as a module and as a dependency ships the same
 * SKILL.md twice, which is not a conflict the user can act on.
 */
export function withoutIdenticalCopies(
  items: readonly SkillCatalogItem[],
): SkillCatalogItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = sameSkillKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function buildSkillCatalog(
  sources: readonly SkillSource[],
): Promise<SkillCatalog> {
  const nested = await Promise.all(sources.map(scanDir));
  const items = withoutIdenticalCopies(nested.flat());
  return { items, duplicateNames: findDuplicateSkillNames(items) };
}
