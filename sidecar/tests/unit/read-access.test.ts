import { describe, expect, it } from "vitest";
import {
  isAutoAllowedRead,
  resolveReadRoots,
} from "../../src/agent/read-access.js";

describe("isAutoAllowedRead", () => {
  const ROOTS = ["/work/dms", "/work/dms/app"];
  const CWD = "/work/dms/app";

  it("allows a read-only tool whose path is inside a root", () => {
    expect(
      isAutoAllowedRead(
        "Read",
        { file_path: "/work/dms/app/page.vue" },
        ROOTS,
        CWD,
      ),
    ).toBe(true);
    expect(
      isAutoAllowedRead(
        "Read",
        { file_path: "/work/dms/modules/dms-ai/src/x.ts" },
        ROOTS,
        CWD,
      ),
    ).toBe(true);
  });

  it("prompts (returns false) for reads outside every root", () => {
    expect(
      isAutoAllowedRead(
        "Read",
        { file_path: "/home/user/.aws/credentials" },
        ROOTS,
        CWD,
      ),
    ).toBe(false);
  });

  it("resolves relative paths against the project cwd", () => {
    expect(
      isAutoAllowedRead("Read", { file_path: "src/x.ts" }, ROOTS, CWD),
    ).toBe(true);
  });

  it("does not let `..` escape a root", () => {
    expect(
      isAutoAllowedRead("Read", { file_path: "../../etc/passwd" }, ROOTS, CWD),
    ).toBe(false);
  });

  it("treats a path-less Glob/Grep as in-scope (defaults to cwd)", () => {
    expect(isAutoAllowedRead("Glob", { pattern: "**/*.ts" }, ROOTS, CWD)).toBe(
      true,
    );
    expect(isAutoAllowedRead("Grep", {}, ROOTS, CWD)).toBe(true);
  });

  it("never auto-allows mutating or non-read tools", () => {
    expect(
      isAutoAllowedRead(
        "Edit",
        { file_path: "/work/dms/app/page.vue" },
        ROOTS,
        CWD,
      ),
    ).toBe(false);
    expect(
      isAutoAllowedRead(
        "Write",
        { file_path: "/work/dms/app/page.vue" },
        ROOTS,
        CWD,
      ),
    ).toBe(false);
    expect(
      isAutoAllowedRead(
        "Bash",
        { command: "cat /work/dms/app/page.vue" },
        ROOTS,
        CWD,
      ),
    ).toBe(false);
  });
});

describe("resolveReadRoots", () => {
  it("includes the host project plus every supplied module root", () => {
    const roots = resolveReadRoots("/work/app", [
      "/work/modules/dms-ai",
      "/work/modules/dms-base",
    ]);
    expect(roots).toContain("/work/app");
    expect(roots).toContain("/work/modules/dms-ai");
    expect(roots).toContain("/work/modules/dms-base");
  });

  it("dedupes and ignores blank module roots", () => {
    const roots = resolveReadRoots("/work/app", ["/work/app", ""]);
    expect(roots).toEqual(["/work/app"]);
  });
});
