import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEGMENT_LABEL_MAX_LENGTH } from "../../src/constants/paths.js";
import { uploadsDirFor } from "../../src/agent/attachment-files.js";
import { safeDirSegment } from "../../src/state/safe-segment.js";

const ROOT = "/srv/app";

// Conversation ids arrive from the websocket as free-form strings and end up
// naming directories that are created, written to and removed recursively.
const CRAFTED_IDS = [
  "../../etc",
  "../".repeat(12),
  "/etc/passwd",
  "C:\\Windows\\System32",
  "..\\..\\secrets",
  "conv/../../..",
  "trailing.",
  " ",
  "",
];

describe("safe directory segments", () => {
  it.each(CRAFTED_IDS)("keeps %j inside its parent", (raw) => {
    const segment = safeDirSegment(raw);
    expect(segment).not.toContain(path.sep);
    expect(segment).not.toContain("/");
    expect(segment).not.toContain("\\");
    expect(segment).not.toContain("..");
    expect(segment.startsWith(".")).toBe(false);
    expect(segment.endsWith(".")).toBe(false);
    expect(path.basename(segment)).toBe(segment);
  });

  it.each(CRAFTED_IDS)(
    "resolves %j under the directory it was joined to",
    (raw) => {
      const resolved = path.resolve(ROOT, safeDirSegment(raw));
      expect(resolved.startsWith(path.resolve(ROOT) + path.sep)).toBe(true);
    },
  );

  // Two ids that reduce to the same label would otherwise share a directory,
  // and one conversation's teardown would delete the other's.
  it("keeps ids apart that sanitize to the same label", () => {
    expect(safeDirSegment("a/b")).not.toBe(safeDirSegment("a_b"));
    expect(safeDirSegment("../x")).not.toBe(safeDirSegment("__x"));
  });

  it("is stable for one id", () => {
    expect(safeDirSegment("conv-42")).toBe(safeDirSegment("conv-42"));
  });

  it("caps the label so the whole path stays within the Windows budget", () => {
    const segment = safeDirSegment("x".repeat(400));
    expect(segment.length).toBeLessThanOrEqual(SEGMENT_LABEL_MAX_LENGTH + 16);
  });

  it("keeps a crafted id inside the uploads tree", () => {
    const dir = uploadsDirFor(ROOT, "../../../../tmp/pwned");
    expect(path.resolve(dir).startsWith(path.resolve(ROOT) + path.sep)).toBe(
      true,
    );
  });
});
