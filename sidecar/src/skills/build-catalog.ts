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

export async function buildSkillCatalog(
  sources: readonly SkillSource[],
): Promise<SkillCatalog> {
  const nested = await Promise.all(sources.map(scanDir));
  return { items: nested.flat() };
}
