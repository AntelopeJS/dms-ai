import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeRequest } from "../../src/agent/permission-preview.js";
import { createPermissionRuleStore } from "../../src/agent/permission-rules.js";

const CONVERSATION_ID = "conv-preview";

describe("permission previews and rules", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dms-ai-preview-"));
    await writeFile(
      join(root, "page.ts"),
      "const a = 1;\nconst b = 2;\nconst c = 3;\n",
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const describeCall = (toolName: string, args: unknown) =>
    describeRequest({
      toolName,
      args,
      hostProjectRoot: root,
      alwaysAskDependencies: true,
      alwaysAskBlockRemoval: true,
    });

  it("diffs an Edit against the file on disk, with real line numbers", async () => {
    const description = await describeCall("Edit", {
      file_path: join(root, "page.ts"),
      old_string: "const b = 2;",
      new_string: "const b = 20;",
    });
    expect(description.preview).toMatchObject({
      type: "diff",
      relativePath: "page.ts",
      isNewFile: false,
      added: 1,
      removed: 1,
    });
    const lines =
      description.preview.type === "diff"
        ? description.preview.hunks[0]?.lines
        : [];
    expect(lines).toContainEqual({
      kind: "add",
      text: "const b = 20;",
      newLine: 2,
    });
    expect(description.ruleOptions).toEqual([
      { kind: "file", value: "page.ts" },
      { kind: "directory", value: "." },
    ]);
  });

  it("applies MultiEdit steps in order", async () => {
    const description = await describeCall("MultiEdit", {
      file_path: "page.ts",
      edits: [
        { old_string: "const a = 1;", new_string: "const a = 10;" },
        { old_string: "const c = 3;", new_string: "const c = 30;" },
      ],
    });
    expect(description.preview).toMatchObject({ added: 2, removed: 2 });
  });

  it("marks a Write to a missing file as new", async () => {
    const description = await describeCall("Write", {
      file_path: join(root, "src", "new.ts"),
      content: "x\n",
    });
    expect(description.preview).toMatchObject({
      isNewFile: true,
      relativePath: "src/new.ts",
      added: 1,
    });
  });

  it("reads a Codex patch from its own diff", async () => {
    const description = await describeCall("Edit", {
      file_path: join(root, "page.ts"),
      change_kind: "update",
      diff: "@@ -2 +2 @@\n-const b = 2;\n+const b = 3;\n",
    });
    expect(description.preview).toMatchObject({ added: 1, removed: 1 });
  });

  it("offers a domain rule for a fetch and none for a search", async () => {
    expect(
      (await describeCall("WebFetch", { url: "https://docs.example.com/a" }))
        .ruleOptions,
    ).toEqual([{ kind: "domain", value: "docs.example.com" }]);
    const search = await describeCall("WebSearch", { query: "x" });
    expect(search).toMatchObject({ kind: "web", ruleOptions: [] });
  });

  it("matches file and directory rules on every file an edit touches", () => {
    const rules = createPermissionRuleStore();
    rules.add(CONVERSATION_ID, { kind: "directory", value: "src" });
    const subject = (args: unknown) => ({
      toolName: "Edit",
      args,
      hostProjectRoot: root,
    });
    expect(
      rules.matches(
        CONVERSATION_ID,
        subject({ file_path: join(root, "src/a/b.ts") }),
      ),
    ).toBe(true);
    expect(
      rules.matches(
        CONVERSATION_ID,
        subject({ file_path: join(root, "srcx/b.ts") }),
      ),
    ).toBe(false);
    expect(
      rules.matches(
        CONVERSATION_ID,
        subject({
          file_paths: [join(root, "src/a.ts"), join(root, "lib/b.ts")],
        }),
      ),
    ).toBe(false);
    expect(
      rules.matches(CONVERSATION_ID, {
        toolName: "Bash",
        args: { command: "ls" },
        hostProjectRoot: root,
      }),
    ).toBe(false);
    rules.add(CONVERSATION_ID, { kind: "file", value: "lib/b.ts" });
    expect(
      rules.matches(
        CONVERSATION_ID,
        subject({
          file_paths: [join(root, "src/a.ts"), join(root, "lib/b.ts")],
        }),
      ),
    ).toBe(true);
  });
});
