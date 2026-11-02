import { describe, expect, it } from "vitest";
import { buildActivityRecords } from "../../src/audit/activity.js";
import { decisionTrail } from "../../src/audit/activity-query.js";
import { buildAllowed, buildKpi } from "../../src/metrics/aggregate.js";
import type { ConversationEntry } from "../../src/state/conversations.js";
import type { AllowedBy, ToolOutcome } from "../../src/constants/audit.js";
import type { StoredMessage } from "../../src/state/types.js";

const NOW = Date.UTC(2026, 10, 2, 12);
const WINDOW = { fromMs: NOW - 1000, toMs: NOW + 1000 };

function call(
  callId: string,
  allowedBy: AllowedBy,
  outcome: ToolOutcome,
): StoredMessage[] {
  const command = JSON.stringify({ command: `run ${callId}` });
  return [
    {
      role: "tool_use",
      content: command,
      toolName: "Bash",
      callId,
      allowedBy,
      timestampMs: NOW,
    },
    {
      role: "tool_result",
      content: '"ok"',
      callId,
      allowedBy,
      outcome,
      timestampMs: NOW + 10,
    },
  ];
}

const ENTRY: ConversationEntry = {
  id: "c-auto",
  title: "Auto review",
  conversation: {
    createdAtMs: NOW,
    updatedAtMs: NOW,
    provider: "claude",
    messages: [
      ...call("approved", "auto_approved", "done"),
      ...call("refused", "auto_denied", "denied"),
    ],
  },
};

const records = buildActivityRecords({
  entries: [ENTRY],
  changeSets: [],
  pending: [],
  running: new Set(),
  hostProjectRoot: "/srv/app",
});
const sources = { records, changeSets: [], entries: [ENTRY] };

function recordOf(callId: string) {
  const record = records.find((r) => r.target.includes(callId));
  if (record === undefined) throw new Error(`no activity for ${callId}`);
  return record;
}

describe("Auto review in Activity and the metrics", () => {
  it("shows a call Auto review refused as denied, and says who decided", () => {
    const refused = recordOf("refused");
    expect(refused).toMatchObject({ result: "denied", category: ["denied"] });
    expect(decisionTrail(refused).map((step) => step.label)).toContain(
      "Blocked by Auto review",
    );
    expect(decisionTrail(recordOf("approved")).map((s) => s.label)).toContain(
      "Allowed by Auto review",
    );
  });

  it("keeps the denial KPI about what a person refused", () => {
    expect(buildKpi(sources, "denied", WINDOW).value).toBe(0);
    const allowed = buildAllowed(sources, WINDOW).items;
    expect(allowed.filter((item) => item.value > 0)).toEqual([
      { id: "auto_approved", value: 1 },
      { id: "auto_denied", value: 1 },
    ]);
  });
});
