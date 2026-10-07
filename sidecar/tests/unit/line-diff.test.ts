import { describe, expect, it } from "vitest";
import { diffTexts, parseUnifiedDiff } from "../../src/agent/line-diff.js";

describe("line diff", () => {
  it("numbers the lines of one change with three lines of context", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].join("\n");
    const after = before.replace("e", "E");
    const { hunks, added, removed } = diffTexts(before, after);
    expect([added, removed]).toEqual([1, 1]);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ oldStart: 2, newStart: 2 });
    expect(hunks[0]?.lines.map((l) => l.kind)).toEqual([
      "context",
      "context",
      "context",
      "remove",
      "add",
      "context",
      "context",
      "context",
    ]);
    expect(hunks[0]?.lines[3]).toEqual({
      kind: "remove",
      text: "e",
      oldLine: 5,
    });
    expect(hunks[0]?.lines[4]).toEqual({ kind: "add", text: "E", newLine: 5 });
  });

  it("keeps distant changes in separate hunks", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const changed = [...lines];
    changed[2] = "first";
    changed[25] = "second";
    expect(diffTexts(lines.join("\n"), changed.join("\n")).hunks).toHaveLength(
      2,
    );
  });

  it("shows a new file as all additions", () => {
    expect(diffTexts("", "x\ny\n")).toMatchObject({ added: 2, removed: 0 });
  });

  it("reads a unified diff with its line numbers", () => {
    const stats = parseUnifiedDiff(
      "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -10,3 +10,3 @@\n alpha\n-beta\n+delta\n gamma\n\\ No newline at end of file\n",
    );
    expect(stats).toMatchObject({ added: 1, removed: 1 });
    expect(stats.hunks[0]?.lines).toEqual([
      { kind: "context", text: "alpha", oldLine: 10, newLine: 10 },
      { kind: "remove", text: "beta", oldLine: 11 },
      { kind: "add", text: "delta", newLine: 11 },
      { kind: "context", text: "gamma", oldLine: 12, newLine: 12 },
    ]);
  });
});
