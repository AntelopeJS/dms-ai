import { describe, expect, it } from "vitest";
import { buildActivityRecords } from "../../src/audit/activity.js";
import { queryActivity } from "../../src/audit/activity-query.js";
import {
  buildAllowed,
  buildKpi,
  buildTopTools,
  buildUsage,
} from "../../src/metrics/aggregate.js";
import type { ConversationEntry } from "../../src/state/conversations.js";
import type { ChangeSetRecord, StoredMessage } from "../../src/state/types.js";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 9, 7, 12);
const ROOT = "/srv/app";
const WINDOW = { fromMs: NOW - 7 * DAY_MS, toMs: NOW + DAY_MS };

function call(
  callId: string,
  toolName: string,
  args: unknown,
  result: Partial<StoredMessage>,
  at = NOW,
): StoredMessage[] {
  return [
    {
      role: "tool_use",
      content: JSON.stringify(args),
      toolName,
      callId,
      timestampMs: at,
    },
    {
      role: "tool_result",
      content: '"ok"',
      callId,
      timestampMs: at + 50,
      ...result,
    },
  ];
}

const CHANGE_SET: ChangeSetRecord = {
  id: "cs-1",
  number: 1,
  conversationId: "c1",
  title: "Edit",
  createdAtMs: NOW,
  agent: "claude",
  scope: "vibe",
  isAutoFix: false,
  overlapped: false,
  files: [{ path: "src/a.ts", status: "modified", added: 3, removed: 1 }],
  added: 3,
  removed: 1,
  typecheck: "passed",
  approvalsNeeded: 1,
  builderOps: 0,
  state: "undone",
  beforeTree: "a",
  afterTree: "b",
  stateLog: [{ state: "undone", atMs: NOW + 1000, by: "Camille" }],
};

const ENTRY: ConversationEntry = {
  id: "c1",
  title: "Build a page",
  conversation: {
    createdAtMs: NOW,
    updatedAtMs: NOW,
    provider: "codex",
    usageLog: [
      { timestampMs: NOW, inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      {
        timestampMs: NOW - DAY_MS,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      },
    ],
    messages: [
      ...call(
        "r1",
        "Read",
        { file_path: `${ROOT}/src/a.ts` },
        { outcome: "done", allowedBy: "read_auto" },
      ),
      ...call(
        "e1",
        "Edit",
        { file_path: `${ROOT}/src/a.ts` },
        { outcome: "done", allowedBy: "approved", changeSetId: "cs-1" },
      ),
      {
        role: "permission",
        content: "",
        toolName: "Edit",
        callId: "e1",
        decision: "approved",
        allowedBy: "approved",
        requestedAtMs: NOW,
        timestampMs: NOW + 10,
        decidedBy: "Camille",
      },
      ...call(
        "b1",
        "mcp__dms-ai__BuilderAddBlock",
        { page: "/p" },
        { outcome: "done", allowedBy: "builder_auto" },
      ),
      ...call(
        "x1",
        "Bash",
        { command: "pnpm build" },
        { outcome: "failed", status: "error", allowedBy: "rule" },
      ),
      {
        role: "permission",
        content: "",
        toolName: "mcp__dms-ai__BuilderDeletePage",
        requestId: "q1",
        decision: "denied",
        allowedBy: "expired",
        kind: "destructive",
        alwaysAsk: true,
        args: { pageRef: "/p" },
        requestedAtMs: NOW,
        timestampMs: NOW + 20,
      },
    ],
  },
};

const records = buildActivityRecords({
  entries: [ENTRY],
  changeSets: [CHANGE_SET],
  pending: [],
  running: new Set(),
  hostProjectRoot: ROOT,
});
const sources = { records, changeSets: [CHANGE_SET], entries: [ENTRY] };

describe("activity log", () => {
  it("has one row per call, approval and undo", () => {
    expect(records.map((r) => r.tool).sort()).toEqual([
      "Bash",
      "BuilderAddBlock",
      "BuilderDeletePage",
      "Edit",
      "Read",
      "UndoChangeSet",
    ]);
    const edit = records.find((r) => r.tool === "Edit");
    expect(edit).toMatchObject({
      target: "src/a.ts",
      agent: "codex",
      changeSetNumber: 1,
      added: 3,
      removed: 1,
      durationMs: 50,
      category: ["changed", "asked"],
    });
    expect(records.find((r) => r.tool === "BuilderDeletePage")).toMatchObject({
      result: "expired",
      category: ["asked", "denied"],
    });
  });

  it("filters, hides read-only calls and pages", () => {
    const page = queryActivity(records, {
      offset: 0,
      limit: 2,
      hideReadOnly: true,
    });
    expect(page.total).toBe(5);
    expect(page.results).toHaveLength(2);
    expect(
      queryActivity(records, {
        offset: 0,
        limit: 10,
        hideReadOnly: false,
        category: "failed",
      }).results.map((r) => r.tool),
    ).toEqual(["Bash"]);
    expect(
      queryActivity(records, {
        offset: 0,
        limit: 10,
        hideReadOnly: false,
        search: "a.ts",
      }).total,
    ).toBe(2);
    expect(page.results[0]).not.toHaveProperty("args");
  });
});

describe("metrics", () => {
  it("counts the approval KPI with its asked, denied and expired totals", () => {
    expect(buildKpi(sources, "approved", WINDOW)).toMatchObject({
      value: 1,
      total: 2,
      expired: 1,
      denied: 0,
    });
    expect(buildKpi(sources, "undone", WINDOW).value).toBe(1);
    expect(buildKpi(sources, "change-sets", WINDOW).value).toBe(1);
    expect(buildKpi(sources, "errors", WINDOW).value).toBe(1);
    expect(buildKpi(sources, "actions", WINDOW).value).toBe(5);
  });

  it("breaks actions down by how they were allowed", () => {
    const allowed = buildAllowed(sources, WINDOW);
    const value = (id: string) => allowed.items.find((i) => i.id === id)?.value;
    expect([
      value("read_auto"),
      value("approved"),
      value("builder_auto"),
      value("rule"),
      value("expired"),
    ]).toEqual([1, 1, 1, 1, 1]);
    expect(allowed).toMatchObject({ deletions: 1, deletionsAsked: 1 });
  });

  it("names the top tools with their source", () => {
    const top = buildTopTools(sources, WINDOW, 10).items;
    expect(top.find((i) => i.id === "BuilderAddBlock")?.source).toBe("builder");
    expect(top.find((i) => i.id === "Edit")?.source).toBe("code");
  });

  it("sums tokens per day and names the costliest chat", () => {
    const usage = buildUsage(sources, { fromMs: NOW - 2 * DAY_MS, toMs: NOW });
    expect(usage.totalTokens).toBe(17);
    expect(usage.days.at(-1)).toEqual({ day: "2026-10-07", totalTokens: 15 });
    expect(usage.top).toEqual({
      conversationId: "c1",
      title: "Build a page",
      totalTokens: 17,
    });
    expect(usage.conversations).toBe(1);
  });
});
