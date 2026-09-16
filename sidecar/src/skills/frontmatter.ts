// Minimal SKILL.md frontmatter parser for the catalog DISPLAY only — the SDK
// parses SKILL.md itself for the agent. Intentionally dependency-free: supports
// `key: scalar`, quoted scalars, and inline arrays `[a, b]` (only `tags` needs
// arrays).
export interface ParsedSkill {
  name: string;
  description: string;
  icon?: string;
  category?: string;
  tags: string[];
  body: string;
}

const FENCE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

function unquote(v: string): string {
  const t = v.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseInlineArray(v: string): string[] {
  const t = v.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return [];
  const inner = t.slice(1, -1).trim();
  if (inner.length === 0) return [];
  return inner
    .split(",")
    .map((s) => unquote(s))
    .filter((s) => s.length > 0);
}

export function parseSkillFile(raw: string): ParsedSkill | null {
  const m = raw.match(FENCE);
  if (m === null) return null;
  const [, head, body] = m;
  const fields: Record<string, string> = {};
  for (const line of head.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (key.length === 0) continue;
    fields[key] = line.slice(idx + 1).trim();
  }
  const name = fields.name ? unquote(fields.name) : "";
  const description = fields.description ? unquote(fields.description) : "";
  if (name.length === 0 || description.length === 0) return null;
  return {
    name,
    description,
    icon: fields.icon ? unquote(fields.icon) : undefined,
    category: fields.category ? unquote(fields.category) : undefined,
    tags: fields.tags ? parseInlineArray(fields.tags) : [],
    body: (body ?? "").trim(),
  };
}
