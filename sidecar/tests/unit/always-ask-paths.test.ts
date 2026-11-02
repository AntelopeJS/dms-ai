import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findAlwaysAskPaths } from "../../src/agent/always-ask-files.js";

let root: string;

function touch(relative: string): string {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dms-ai-always-ask-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("findAlwaysAskPaths", () => {
  it("finds the dependency files at the root and in nested modules", () => {
    const expected = [
      touch("package.json"),
      touch("pnpm-lock.yaml"),
      touch("modules/shop/package.json"),
    ];
    touch("src/index.ts");

    expect(findAlwaysAskPaths([root]).dependencies.sort()).toEqual(
      expected.sort(),
    );
  });

  it("lists .git and .husky once as whole trees, and the hook manager configs", () => {
    touch(".git/hooks/pre-commit");
    touch(".git/config");
    touch(".husky/pre-commit");
    const lefthook = touch("lefthook.yml");
    const preCommit = touch("tools/.pre-commit-config.yaml");

    expect(findAlwaysAskPaths([root]).gitHooks.sort()).toEqual(
      [join(root, ".git"), join(root, ".husky"), lefthook, preCommit].sort(),
    );
  });

  it("does not walk node_modules or linked directories", () => {
    touch("node_modules/left-pad/package.json");
    const outside = mkdtempSync(join(tmpdir(), "dms-ai-always-ask-link-"));
    writeFileSync(join(outside, "package.json"), "");
    symlinkSync(outside, join(root, "linked"));
    try {
      expect(findAlwaysAskPaths([root])).toEqual({
        gitHooks: [],
        dependencies: [],
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("walks every root it is given, once per path", () => {
    const own = touch("package.json");
    const module = touch("modules/shop/package.json");

    expect(
      findAlwaysAskPaths([
        root,
        join(root, "modules/shop"),
      ]).dependencies.sort(),
    ).toEqual([own, module].sort());
  });
});
