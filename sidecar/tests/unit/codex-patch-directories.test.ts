import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import type { PermissionOutcome } from "../../src/agent/permission-bus.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { CODEX_FILE_CHANGE_APPROVAL_METHOD } from "../../src/constants/codex.js";
import { createCodexAdapter } from "../../src/providers/codex/adapter.js";
import { createCodexPermissionHandler } from "../../src/providers/codex/permissions.js";
import type { TurnSettings } from "../../src/state/settings-types.js";
import { createTestBus } from "../helpers/permission-bus.js";
import { TURN_SETTINGS } from "../helpers/turn-settings.js";

beforeAll(() => setBuilderAvailable(true));
afterAll(() => setBuilderAvailable(false));

const ITEM_ID = "call_1";
const APPROVED: PermissionOutcome = { isAllowed: true, allowedBy: "approved" };
const DENIED: PermissionOutcome = { isAllowed: false, allowedBy: "denied" };
const VIBE: TurnSettings = { ...TURN_SETTINGS, generationMode: "vibe" };
const SAFE: TurnSettings = { ...TURN_SETTINGS, generationMode: "safe" };

type Kind = { type: "add" } | { type: "update"; move_path: string | null };

interface Change {
  path: string;
  kind: Kind;
}

const scratch: string[] = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function workspace() {
  const base = mkdtempSync(join(tmpdir(), "codex-patch-dirs-"));
  scratch.push(base);
  const project = join(base, "project");
  const module = join(base, "module");
  mkdirSync(join(project, "src"), { recursive: true });
  mkdirSync(join(project, ".git", "hooks"), { recursive: true });
  mkdirSync(module);
  return { base, project, module };
}

interface Run {
  project: string;
  module: string;
  changes: Change[];
  outcome?: PermissionOutcome;
  settings?: TurnSettings;
  cancelled?: boolean;
}

async function approve(run: Run): Promise<string> {
  const adapter = createCodexAdapter();
  adapter.handle({
    method: "item/started",
    params: {
      item: {
        type: "fileChange",
        id: ITEM_ID,
        status: "inProgress",
        changes: run.changes.map((change) => ({ ...change, diff: "x\n" })),
      },
    },
  });
  const { bus } = createTestBus();
  bus.requestPermission = async () => run.outcome ?? APPROVED;
  const handler = createCodexPermissionHandler({
    conversationId: "conv-dirs",
    permissionBus: bus,
    getSettings: () => run.settings ?? VIBE,
    getChanges: (itemId) => adapter.getChanges(itemId),
    hostProjectRoot: run.project,
    moduleRoots: [run.module],
  });
  if (run.cancelled === true) handler.cancelPending();
  const { decision } = await handler.handle({
    id: 1,
    method: CODEX_FILE_CHANGE_APPROVAL_METHOD,
    params: { itemId: ITEM_ID },
  });
  return decision;
}

const ADD: Kind = { type: "add" };

describe("approved patch directories", () => {
  it("creates the missing parents of an added file, and not the file", async () => {
    const { project, module } = workspace();
    const file = join(project, "src", "a", "b", "c", "new.ts");
    expect(
      await approve({ project, module, changes: [{ path: file, kind: ADD }] }),
    ).toBe("accept");
    expect(existsSync(join(project, "src", "a", "b", "c"))).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it("creates the parents of every added file and of a move's destination", async () => {
    const { project, module } = workspace();
    await approve({
      project,
      module,
      changes: [
        { path: join(project, ".git", "hooks", "newdir", "x"), kind: ADD },
        { path: join(module, "lib", "y.ts"), kind: ADD },
        {
          path: join(project, "src", "old.ts"),
          kind: { type: "update", move_path: join(project, "moved", "old.ts") },
        },
      ],
    });
    expect(existsSync(join(project, ".git", "hooks", "newdir"))).toBe(true);
    expect(existsSync(join(module, "lib"))).toBe(true);
    expect(existsSync(join(project, "moved"))).toBe(true);
  });

  it("creates nothing for an update that stays in place", async () => {
    const { project, module } = workspace();
    await approve({
      project,
      module,
      changes: [
        {
          path: join(project, "gone", "a.ts"),
          kind: { type: "update", move_path: null },
        },
      ],
    });
    expect(existsSync(join(project, "gone"))).toBe(false);
  });

  it.each([
    ["declined", { outcome: DENIED }],
    ["cancelled", { cancelled: true }],
    ["refused by Safe scope", { settings: SAFE }],
  ])("creates nothing when %s", async (_label, answer) => {
    const { project, module } = workspace();
    const decision = await approve({
      project,
      module,
      changes: [{ path: join(project, "src", "newdir", "x.txt"), kind: ADD }],
      ...answer,
    });
    expect(decision).toBe("decline");
    expect(existsSync(join(project, "src", "newdir"))).toBe(false);
  });

  it("creates nothing outside the project and module roots", async () => {
    const { base, project, module } = workspace();
    await approve({
      project,
      module,
      changes: [
        { path: join(base, "outside", "x.txt"), kind: ADD },
        { path: join(project, "..", "escaped", "x.txt"), kind: ADD },
      ],
    });
    expect(existsSync(join(base, "outside"))).toBe(false);
    expect(existsSync(join(base, "escaped"))).toBe(false);
  });

  it.each([
    ["a directory named .env", join("src", ".env", "x.txt")],
    ["a directory named .env.local", join("src", ".ENV.local", "deep", "x")],
    ["a new secret file", join("src", "newdir", ".env")],
  ])("creates nothing for %s", async (_label, relativePath) => {
    const { project, module } = workspace();
    await approve({
      project,
      module,
      changes: [{ path: join(project, relativePath), kind: ADD }],
    });
    const [first, second] = relativePath.split("/");
    expect(existsSync(join(project, first ?? "", second ?? ""))).toBe(false);
  });

  it("does not follow a symlink out of the project", async () => {
    const { base, project, module } = workspace();
    const outside = join(base, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(project, "src", "link"));
    await approve({
      project,
      module,
      changes: [
        { path: join(project, "src", "link", "newdir", "x.txt"), kind: ADD },
      ],
    });
    expect(existsSync(join(outside, "newdir"))).toBe(false);
  });
});
