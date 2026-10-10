import { bareToolName, isCommandTool } from "../agent/tool-kinds.js";
import { parseArgs } from "../audit/activity-target.js";
import {
  SKILL_FILE_NAME,
  SKILL_TOOL_ARG_KEYS,
  SKILL_TOOL_NAME,
} from "../constants/tool-kinds.js";
import type { ConversationEntry } from "../state/conversations.js";
import type { StoredMessage } from "../state/types.js";
import type { SkillCatalog, SkillCatalogItem } from "./build-catalog.js";
import { LOCAL_SKILLS_PROVENANCE } from "./resolve-sources.js";

const MS_PER_DAY = 86_400_000;
const USAGE_WINDOW_DAYS = 30;
const LOCAL_SKILLS_ORIGIN = "~/.claude/skills";
const QUALIFIED_SEPARATOR = ":";

export type SkillSourceKind = "module" | "local";

export interface SkillOrigin {
  source: SkillSourceKind;
  origin: string;
}

/** A catalog entry with its use and whether a same-named skill hides it. */
export interface EnrichedSkill extends SkillCatalogItem, SkillOrigin {
  uses30d: number;
  lastUsedAtMs?: number;
  lastConversationId?: string;
  isShadowed: boolean;
  shadowedBy?: string;
}

export interface SkillConflict {
  name: string;
  winner: SkillOrigin;
  ignored: SkillOrigin[];
}

interface SkillUse {
  name: string;
  timestampMs: number;
  conversationId: string;
}

export function originOf(item: SkillCatalogItem): SkillOrigin {
  const isLocal = item.provenance === LOCAL_SKILLS_PROVENANCE;
  return {
    source: isLocal ? "local" : "module",
    origin: isLocal ? LOCAL_SKILLS_ORIGIN : item.provenance,
  };
}

function bareSkillName(name: string): string {
  const index = name.lastIndexOf(QUALIFIED_SEPARATOR);
  return index < 0 ? name : name.slice(index + 1);
}

function skillToolName(args: unknown): string | undefined {
  if (args === null || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const key = SKILL_TOOL_ARG_KEYS.find((k) => typeof record[k] === "string");
  return key === undefined ? undefined : bareSkillName(record[key] as string);
}

// Codex has no skill tool: it opens the SKILL.md file with a shell command.
function skillFileRead(args: unknown, names: readonly string[]) {
  const text = JSON.stringify(args ?? "");
  return names.find((name) => text.includes(`${name}/${SKILL_FILE_NAME}`));
}

function usedSkill(message: StoredMessage, names: readonly string[]) {
  const toolName = bareToolName(message.toolName ?? "");
  const args = parseArgs(message.content);
  if (toolName === SKILL_TOOL_NAME) return skillToolName(args);
  if (isCommandTool(toolName)) return skillFileRead(args, names);
  return undefined;
}

function collectUses(
  entries: readonly ConversationEntry[],
  names: readonly string[],
): SkillUse[] {
  return entries.flatMap((entry) =>
    entry.conversation.messages
      .filter((m) => m.role === "tool_use")
      .flatMap((message) => {
        const name = usedSkill(message, names);
        return name === undefined
          ? []
          : [
              {
                name,
                timestampMs: message.timestampMs,
                conversationId: entry.id,
              },
            ];
      }),
  );
}

/** The first source to declare a name wins; later ones are shadowed. */
function winners(
  items: readonly SkillCatalogItem[],
): Map<string, SkillCatalogItem> {
  const byName = new Map<string, SkillCatalogItem>();
  for (const item of items)
    if (!byName.has(item.name)) byName.set(item.name, item);
  return byName;
}

export function enrichSkills(
  catalog: SkillCatalog,
  entries: readonly ConversationEntry[],
  nowMs: number,
): EnrichedSkill[] {
  const names = [...new Set(catalog.items.map((i) => i.name))];
  const uses = collectUses(entries, names);
  const since = nowMs - USAGE_WINDOW_DAYS * MS_PER_DAY;
  const firstByName = winners(catalog.items);
  return catalog.items.map((item) => {
    const own = uses.filter((u) => u.name === item.name);
    const last = own.reduce<SkillUse | undefined>(
      (latest, u) =>
        latest === undefined || u.timestampMs > latest.timestampMs ? u : latest,
      undefined,
    );
    const winner = firstByName.get(item.name);
    const isShadowed = winner !== undefined && winner.id !== item.id;
    return {
      ...item,
      ...originOf(item),
      uses30d: own.filter((u) => u.timestampMs >= since).length,
      lastUsedAtMs: last?.timestampMs,
      lastConversationId: last?.conversationId,
      isShadowed,
      shadowedBy: isShadowed ? winner.id : undefined,
    };
  });
}

/** Names declared by more than one source: who wins, who is ignored. */
export function skillConflicts(catalog: SkillCatalog): SkillConflict[] {
  const firstByName = winners(catalog.items);
  return catalog.duplicateNames.map((name) => {
    const winner = firstByName.get(name) as SkillCatalogItem;
    return {
      name,
      winner: originOf(winner),
      ignored: catalog.items
        .filter((item) => item.name === name && item.id !== winner.id)
        .map(originOf),
    };
  });
}
