import { describe, expect, it } from "vitest";
import { enrichSkills, skillConflicts } from "../../src/skills/skill-usage.js";
import type { SkillCatalog } from "../../src/skills/build-catalog.js";
import type { ConversationEntry } from "../../src/state/conversations.js";

const NOW = Date.UTC(2026, 9, 7);
const DAY_MS = 86_400_000;

function item(provenance: string, name: string) {
  return {
    id: `${provenance}:${name}`,
    name,
    description: "",
    tags: [],
    provenance,
    body: "",
  };
}

const CATALOG: SkillCatalog = {
  items: [
    item("@antelopejs/dms-ai", "page-builder"),
    item("local", "page-builder"),
    item("local", "other"),
  ],
  duplicateNames: ["page-builder"],
};

const ENTRY: ConversationEntry = {
  id: "c1",
  title: "t",
  conversation: {
    createdAtMs: NOW,
    updatedAtMs: NOW,
    messages: [
      {
        role: "tool_use",
        toolName: "Skill",
        content: JSON.stringify({ skill: "dms-ai:page-builder" }),
        timestampMs: NOW - DAY_MS,
      },
      {
        role: "tool_use",
        toolName: "Skill",
        content: JSON.stringify({ skill: "page-builder" }),
        timestampMs: NOW - 40 * DAY_MS,
      },
      {
        role: "tool_use",
        toolName: "Bash",
        content: JSON.stringify({ command: "cat /x/other/SKILL.md" }),
        timestampMs: NOW,
      },
    ],
  },
};

describe("skill usage", () => {
  it("counts uses over 30 days, from the Skill tool and SKILL.md reads", () => {
    const [winner, shadowed, other] = enrichSkills(CATALOG, [ENTRY], NOW);
    expect(winner).toMatchObject({
      uses30d: 1,
      lastConversationId: "c1",
      isShadowed: false,
      source: "module",
      origin: "@antelopejs/dms-ai",
    });
    expect(winner?.lastUsedAtMs).toBe(NOW - DAY_MS);
    expect(shadowed).toMatchObject({
      isShadowed: true,
      shadowedBy: "@antelopejs/dms-ai:page-builder",
      source: "local",
      origin: "~/.claude/skills",
    });
    expect(other).toMatchObject({ uses30d: 1 });
  });

  it("names the winner and the ignored copies of a duplicate", () => {
    expect(skillConflicts(CATALOG)).toEqual([
      {
        name: "page-builder",
        winner: { source: "module", origin: "@antelopejs/dms-ai" },
        ignored: [{ source: "local", origin: "~/.claude/skills" }],
      },
    ]);
  });
});
