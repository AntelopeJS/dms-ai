import { rmSync } from "node:fs";
import { join } from "node:path";
import { MS_DAY, MS_HOUR, MS_MINUTE, conversation, permission, projectRoot, recordChangeSet, toolResult, toolUse, userMessage, writeProjectFile } from "./seed.mjs";
import { windowStart } from "./windows.mjs";

/** @typedef {import("./ai.mjs").Ctx} Ctx */
/** @typedef {Record<string, unknown>} Row */

/** @typedef {[string, Record<string, unknown>, string, string, boolean, string]} Call */

/**
 * Calls of the sample conversation: `[tool, args, allowedBy, outcome, asked, changeSet]`, one every two minutes.
 *
 * @type {Call[]}
 */
const CALLS = [
  ["Read", { file_path: "src/a.ts" }, "read_auto", "done", false, ""],
  ["Read", { file_path: "src/b.ts" }, "read_auto", "done", false, ""],
  ["Read", { file_path: "src/c.ts" }, "read_auto", "done", false, ""],
  ["Skill", { skill: "dms-ai" }, "read_auto", "done", false, ""],
  ["Skill", { skill: "dms-ai" }, "read_auto", "done", false, ""],
  ["Skill", { skill: "dms-ai-code-mode" }, "read_auto", "done", false, ""],
  ["Skill", { skill: "dms-ai" }, "read_auto", "done", false, ""],
  ["Skill", { skill: "dms-ai" }, "read_auto", "done", false, ""],
  ["builder_add_block", { pageId: "home" }, "builder_auto", "done", false, "one"],
  ["builder_add_block", { pageId: "orders" }, "builder_auto", "done", false, "one"],
  ["Write", { file_path: "src/notes/a.txt" }, "approved", "done", true, "one"],
  ["Bash", { command: "pnpm add dayjs" }, "rule", "done", true, ""],
  ["Bash", { command: "pnpm test" }, "rule", "stopped", false, ""],
  ["Bash", { command: "pnpm build" }, "expired", "denied", true, ""],
  ["Bash", { command: "pnpm lint" }, "full_auto", "failed", false, ""],
  ["Bash", { command: "rm -rf dist" }, "denied", "denied", true, ""],
  ["Bash", { command: "pnpm install" }, "rule", "done", false, ""],
  ["Edit", { file_path: "src/notes/b.txt" }, "denied", "denied", true, ""],
  ["Edit", { file_path: "src/notes/c.txt" }, "blocked", "blocked", false, ""],
  ["Edit", { file_path: "src/notes/b.txt" }, "approved", "done", true, "two"],
  ["Edit", { file_path: "src/notes/b.txt" }, "approved", "done", true, "two"],
  ["builder_delete_page", { pageRef: "/orders" }, "approved", "done", true, ""],
  ["Grep", { pattern: "total" }, "read_auto", "done", false, ""],
  ["Glob", { pattern: '=SUM(1,2),"q"' }, "read_auto", "done", false, ""],
];

/** The ways the sample's calls were allowed, in the Overview's order. */
export const SAMPLE_ALLOWED = [
  ["read_auto", 10], ["builder_auto", 2], ["approved", 4], ["rule", 3], ["full_auto", 1], ["blocked", 1], ["denied", 2], ["expired", 1],
];

/** Calls per tool, most used first. */
export const SAMPLE_TOOLS = [["Bash", 6], ["Skill", 5], ["Edit", 4], ["Read", 3], ["builder_add_block", 2]];

/** How many calls the sample holds in the last seven days. */
export const SAMPLE_CALLS = CALLS.length;

/**
 * Adds two token entries at the edge of the 14 days the Usage section counts: one in its first day (300 tokens), one
 * a day before it (700 tokens, left out).
 *
 * @param {Row} stored The conversation
 * @param {number} now The time the sample is relative to
 * @returns {Row} The conversation with the two entries
 */
function withUsageEdge(stored, now) {
  const startOfToday = Math.floor(now / MS_DAY) * MS_DAY;
  const entry = (/** @type {number} */ tokens, /** @type {number} */ at) => ({ inputTokens: tokens, outputTokens: 0, totalTokens: tokens, timestampMs: at });
  /** @type {unknown[]} */
  const log = Array.isArray(stored.usageLog) ? stored.usageLog : [];
  return { ...stored, usageLog: [...log, entry(300, startOfToday - 13 * MS_DAY + MS_HOUR), entry(700, startOfToday - 14 * MS_DAY + 23 * MS_HOUR)] };
}

/**
 * @param {string} outcome How the call ended
 * @returns {Row} The fields that say so
 */
function ended(outcome) {
  if (outcome === "done") return {};
  return outcome === "failed" ? { status: "error", outcome: "failed" } : { outcome };
}

/**
 * The sample audit log: one conversation of 24 calls in the last three hours, 15 "edge" reads on both sides of the 24 hour, 7 day and 30 day windows, a Codex conversation of 3 reads ten days
 * ago (the last of them a Skill call) and a conversation of 2 reads forty days ago.
 *
 * @param {number} now The time the sample is relative to
 * @param {{ one?: string, two?: string }} sets The change set ids calls belong to
 * @returns {Record<string, Row>} The conversations
 */
export function sampleConversations(now, sets) {
  const start = now - 3 * 60 * MS_MINUTE;
  const messages = [userMessage("Add a revenue chart", start - MS_MINUTE)];
  CALLS.forEach(([tool, args, allowedBy, outcome, asked, set], index) => {
    const at = start + index * 2 * MS_MINUTE;
    const id = `call-${index + 1}`;
    const changeSetId = set === "one" ? sets.one : set === "two" ? sets.two : undefined;
    const owned = changeSetId === undefined ? {} : { changeSetId };
    messages.push(toolUse(id, tool, args, at, { allowedBy, ...owned }));
    if (asked) messages.push(permission(id, tool, at, { allowedBy, kind: tool.startsWith("builder_") ? "destructive" : "edit", summary: `${tool} ${JSON.stringify(args)}`, decidedBy: "Verify Admin", alwaysAsk: tool === "builder_delete_page", feedback: allowedBy === "denied" ? "use the Builder" : undefined }));
    messages.push(toolResult(id, at + 1500, { allowedBy, content: `${tool} answered`, ...ended(outcome), ...owned }));
  });
  /**
   * @param {string} title The conversation's first message
   * @param {number} ago How many days ago
   * @param {number} count How many calls
   * @param {string} provider The agent
   * @param {number} tokens Tokens it used
   * @returns {Row} The conversation
   */
  const old = (title, ago, count, provider, tokens) => {
    const at = now - ago * MS_DAY;
    const rows = [userMessage(title, at - MS_MINUTE)];
    for (let i = 0; i < count; i += 1) {
      const isSkill = ago === 10 && i === count - 1;
      rows.push(toolUse(`old-${ago}-${i}`, isSkill ? "Skill" : "Read", isSkill ? { skill: "dms-builder-safe" } : { file_path: `docs/${i}.md` }, at + i * MS_MINUTE, { allowedBy: "read_auto" }), toolResult(`old-${ago}-${i}`, at + i * MS_MINUTE + 800, { allowedBy: "read_auto" }));
    }
    return conversation(rows, { provider, tokenUsage: { inputTokens: tokens, outputTokens: 0, totalTokens: tokens }, usageLog: [{ inputTokens: tokens, outputTokens: 0, totalTokens: tokens, timestampMs: at }] });
  };
  /**
   * Calls `ago` days back, one every minute, of one tool.
   *
   * @param {string} tool The tool
   * @param {Record<string, unknown>} args Its arguments
   * @param {number} agoMs How long ago
   * @param {number} count How many calls
   * @param {string} tag Tells the call ids apart
   * @returns {Row[]} The messages
   */
  const calls = (tool, args, agoMs, count, tag) => {
    const rows = [];
    for (let i = 0; i < count; i += 1) {
      const at = now - agoMs + i * MS_MINUTE;
      rows.push(toolUse(`edge-${tag}-${i}`, tool, args, at, { allowedBy: "read_auto" }), toolResult(`edge-${tag}-${i}`, at + 500, { allowedBy: "read_auto" }));
    }
    return rows;
  };
  const sevenDays = now - windowStart(now, 7);
  const edge = conversation([
    userMessage("Edge reads", now - 32 * MS_DAY),
    ...calls("LS", { path: "src" }, 23 * MS_HOUR, 2, "23h"),
    ...calls("LS", { path: "docs" }, 25 * MS_HOUR, 3, "25h"),
    ...calls("LS", { path: "tests" }, sevenDays - 2 * MS_HOUR, 2, "in-7d"),
    ...calls("LS", { path: "lib" }, sevenDays + 2 * MS_HOUR, 3, "out-7d"),
    ...calls("Skill", { skill: "dms-pages" }, 29 * MS_DAY, 2, "29d"),
    ...calls("Skill", { skill: "dms-pages" }, 31 * MS_DAY, 3, "31d"),
  ]);
  return {
    "conv-edge": edge,
    "conv-new": conversation(messages, { tokenUsage: { inputTokens: 900, outputTokens: 100, totalTokens: 1000 }, usageLog: [{ inputTokens: 900, outputTokens: 100, totalTokens: 1000, timestampMs: start }] }),
    "conv-ten": old("Explain the project", 10, 3, "codex", 400),
    "conv-forty": withUsageEdge(old("Old question", 40, 2, "claude", 5000), now),
  };
}

/**
 * Five real change sets over files of the project: the first adds `a.txt` and `f.txt`, the second edits `b.txt` and adds
 * `e.txt` (two files), the third edits `a.txt` and `f.txt` again (so undoing the first has a later set sharing two
 * files), the fourth deletes `g.txt`, and the fifth adds `d.txt` and edits `f.txt` (two files, one of them shared with the first set): five sets, one more than the four the Overview lists.
 *
 * @param {Ctx} ctx The journey
 * @param {number} now The time the sample is relative to
 * @returns {Row[]} The records for `change-sets.json`
 */
export function sampleChangeSets(ctx, now) {
  const one = recordChangeSet(ctx, { id: "cs-one", number: 1, title: "Add the notes files", conversationId: "conv-new", createdAtMs: now - 170 * MS_MINUTE, askedBy: "Verify Admin", approvalsNeeded: 1, builderOps: 2, typecheck: "skipped", pagePath: "/home" }, () => {
    writeProjectFile(ctx, "src/notes/a.txt", "first note\n");
    writeProjectFile(ctx, "src/notes/f.txt", "shared note\n");
  });
  writeProjectFile(ctx, "src/notes/b.txt", "line one\nline two\n");
  const two = recordChangeSet(ctx, { id: "cs-two", number: 2, title: "Reword the second note", conversationId: "conv-new", createdAtMs: now - 160 * MS_MINUTE, scope: "vibe", askedBy: "Verify Admin", approvalsNeeded: 2, typecheck: "failed", overlapped: true }, () => {
    writeProjectFile(ctx, "src/notes/b.txt", "line one\nline 2 reworded\nline three\n");
    writeProjectFile(ctx, "src/notes/e.txt", "extra note\n");
  });
  const three = recordChangeSet(ctx, { id: "cs-three", number: 3, title: "Extend the notes", conversationId: "conv-new", createdAtMs: now - 150 * MS_MINUTE, askedBy: "Verify Admin", isAutoFix: true }, () => {
    writeProjectFile(ctx, "src/notes/a.txt", "first note\nsecond line\n");
    writeProjectFile(ctx, "src/notes/f.txt", "shared note\nsecond line\n");
  });
  writeProjectFile(ctx, "src/notes/g.txt", "old note\nold note again\n");
  const four = recordChangeSet(ctx, { id: "cs-four", number: 4, title: "Remove the old note", conversationId: "conv-new", createdAtMs: now - 140 * MS_MINUTE, askedBy: "Verify Admin" }, () => rmSync(join(projectRoot(ctx), "src", "notes", "g.txt")));
  const five = recordChangeSet(ctx, { id: "cs-five", number: 5, title: "Add the fourth note", conversationId: "conv-new", createdAtMs: now - 130 * MS_MINUTE, askedBy: "Verify Admin" }, () => {
    writeProjectFile(ctx, "src/notes/d.txt", "fourth note\n");
    writeProjectFile(ctx, "src/notes/f.txt", "shared note\nsecond line\nthird line\n");
  });
  return [one, two, three, four, five];
}
