import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ChangeSetActionError,
  type Checkpoints,
  checkpointExcludes,
  createCheckpoints,
  type TurnChangeMeta,
} from "../../src/checkpoints/checkpoints.js";
import { createShadowGit } from "../../src/checkpoints/shadow-git.js";
import { createChangeSetStore } from "../../src/state/change-sets.js";

const STATE_SEGMENTS = ["node_modules", ".cache", "dms-ai"];
const RETENTION_DAYS = 30;
const MS_PER_DAY = 86_400_000;

function meta(title: string): TurnChangeMeta {
  return {
    conversationId: "conv-1",
    title,
    agent: "claude",
    scope: "vibe",
    isAutoFix: false,
    askedBy: "Camille",
    approvalsNeeded: 1,
    builderOps: 0,
    typecheck: "skipped",
  };
}

interface Project {
  root: string;
  stateDir: string;
  checkpoints: Checkpoints;
}

async function openProject(root: string): Promise<Project> {
  const stateDir = join(root, ...STATE_SEGMENTS);
  const checkpoints = createCheckpoints({
    git: createShadowGit({
      gitDir: join(stateDir, "checkpoints.git"),
      workTree: root,
      extraExcludes: checkpointExcludes(stateDir, root),
    }),
    store: createChangeSetStore(join(stateDir, "change-sets.json")),
  });
  await checkpoints.start(RETENTION_DAYS);
  return { root, stateDir, checkpoints };
}

async function turn(
  project: Project,
  title: string,
  edit: () => Promise<void>,
) {
  const checkpoint = project.checkpoints.beginTurn("conv-1");
  await checkpoint.ready();
  await edit();
  return checkpoint.finish(meta(title));
}

const read = (root: string, file: string) => readFile(join(root, file), "utf8");

describe("checkpoints", () => {
  let root: string;
  let project: Project;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dms-ai-checkpoints-"));
    await writeFile(join(root, "a.ts"), "one\ntwo\nthree\n");
    await writeFile(join(root, ".gitignore"), "ignored.log\n");
    await mkdir(join(root, "node_modules", "dep"), { recursive: true });
    await writeFile(join(root, "node_modules", "dep", "x.js"), "x");
    project = await openProject(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is available when git is installed", () => {
    expect(project.checkpoints.isAvailable()).toBe(true);
  });

  it("records what a turn changed, with line counts, and nothing else", async () => {
    const record = await turn(project, "Rename two", async () => {
      await writeFile(join(root, "a.ts"), "one\nTWO\nthree\n");
      await writeFile(join(root, "b.ts"), "new\n");
      await writeFile(join(root, "ignored.log"), "noise");
      await writeFile(join(root, "node_modules", "dep", "x.js"), "changed");
    });
    expect(record?.number).toBe(1);
    expect(record?.files).toEqual([
      { path: "a.ts", status: "modified", added: 1, removed: 1 },
      { path: "b.ts", status: "added", added: 1, removed: 0 },
    ]);
    expect(record).toMatchObject({
      added: 2,
      removed: 1,
      askedBy: "Camille",
      state: "applied",
    });
    const details = await project.checkpoints.fileDetails(record?.id as string);
    expect(details[0]?.hunks[0]?.lines).toContainEqual({
      kind: "add",
      text: "TWO",
      newLine: 2,
    });
  });

  it("records nothing for a turn that changed nothing", async () => {
    expect(await turn(project, "Read only", async () => {})).toBeNull();
  });

  it("undoes and redoes a change set, deleting the files it created", async () => {
    const record = await turn(project, "Edit", async () => {
      await writeFile(join(root, "a.ts"), "changed\n");
      await writeFile(join(root, "b.ts"), "new\n");
    });
    const id = record?.id as string;
    const [undone] = await project.checkpoints.undo(id, false, "Camille");
    expect(undone).toMatchObject({
      state: "undone",
      stateChangedBy: "Camille",
    });
    expect(await read(root, "a.ts")).toBe("one\ntwo\nthree\n");
    expect(existsSync(join(root, "b.ts"))).toBe(false);
    await expect(project.checkpoints.undo(id, false)).rejects.toBeInstanceOf(
      ChangeSetActionError,
    );
    await project.checkpoints.redo(id, "Camille");
    expect(await read(root, "a.ts")).toBe("changed\n");
    expect(await read(root, "b.ts")).toBe("new\n");
    expect(project.checkpoints.get(id)?.stateLog?.map((c) => c.state)).toEqual([
      "undone",
      "applied",
    ]);
  });

  it("lists later sets touching the same files as conflicts, and undoes them together", async () => {
    const first = await turn(project, "First", async () => {
      await writeFile(join(root, "a.ts"), "first\n");
    });
    const second = await turn(project, "Second", async () => {
      await writeFile(join(root, "a.ts"), "second\n");
    });
    await turn(project, "Unrelated", async () => {
      await writeFile(join(root, "c.ts"), "c\n");
    });
    const preview = project.checkpoints.undoPreview(first?.id as string);
    expect(preview.conflicts).toEqual([
      { changeSetId: second?.id, number: 2, title: "Second", files: ["a.ts"] },
    ]);
    const undone = await project.checkpoints.undo(first?.id as string, true);
    expect(undone.map((c) => c.number)).toEqual([2, 1]);
    expect(await read(root, "a.ts")).toBe("one\ntwo\nthree\n");
    expect(await read(root, "c.ts")).toBe("c\n");
  });

  it("flags a change set whose turn overlapped another running one", async () => {
    const one = project.checkpoints.beginTurn("conv-1");
    const two = project.checkpoints.beginTurn("conv-2");
    await one.ready();
    await two.ready();
    await writeFile(join(root, "a.ts"), "overlap\n");
    const record = await one.finish(meta("One"));
    await two.finish(meta("Two"));
    expect(record?.overlapped).toBe(true);
  });

  it("never touches the project's own repository", async () => {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    await turn(project, "Edit", async () => {
      await writeFile(join(root, "a.ts"), "changed\n");
    });
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(status).toContain("?? a.ts");
    expect(
      execFileSync("git", ["rev-list", "--all"], {
        cwd: root,
        encoding: "utf8",
      }),
    ).toBe("");
  });

  it("prunes change sets older than the retention at start", async () => {
    const record = await turn(project, "Old", async () => {
      await writeFile(join(root, "a.ts"), "old\n");
    });
    await project.checkpoints.flush();
    const file = join(project.stateDir, "change-sets.json");
    const stored = JSON.parse(await readFile(file, "utf8"));
    stored.changeSets[0].createdAtMs =
      Date.now() - (RETENTION_DAYS + 1) * MS_PER_DAY;
    await writeFile(file, JSON.stringify(stored));
    const reopened = await openProject(root);
    expect(reopened.checkpoints.get(record?.id as string)).toBeNull();
    expect(reopened.checkpoints.all()).toEqual([]);
    await reopened.checkpoints.flush();
  });
});
