import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChangeSetStore } from "../../src/state/change-sets.js";
import type { ChangeSetRecord } from "../../src/state/types.js";

const TMP_PREFIX = "dms-ai-change-sets-";
const FILE_ENCODING = "utf8";

const RECORD: ChangeSetRecord = {
  id: "cs-1",
  number: 1,
  conversationId: "c1",
  title: "Edit",
  createdAtMs: 1,
  agent: "claude",
  scope: "vibe",
  isAutoFix: false,
  overlapped: false,
  files: [{ path: "src/a.ts", status: "modified", added: 3, removed: 1 }],
  added: 3,
  removed: 1,
  typecheck: "passed",
  approvalsNeeded: 0,
  builderOps: 0,
  state: "applied",
  beforeTree: "a",
  afterTree: "b",
};

describe("change-set file loading", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    filePath = join(dir, "change-sets.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("drops a record of another shape and keeps the others and the numbering", async () => {
    const stored = {
      nextNumber: 4,
      changeSets: [
        RECORD,
        { ...RECORD, id: "cs-2", number: 2, beforeTree: undefined },
        { ...RECORD, id: "cs-3", number: 3, state: "reverted" },
      ],
    };
    await writeFile(filePath, JSON.stringify(stored), FILE_ENCODING);
    const store = createChangeSetStore(filePath);
    await store.load();
    expect(store.all()).toEqual([RECORD]);
    expect(store.nextNumber()).toBe(4);
  });

  it("numbers after every stored record when the file has no next number", async () => {
    const stored = { changeSets: [RECORD, { id: "cs-2" }] };
    await writeFile(filePath, JSON.stringify(stored), FILE_ENCODING);
    const store = createChangeSetStore(filePath);
    await store.load();
    expect(store.nextNumber()).toBe(3);
  });
});
