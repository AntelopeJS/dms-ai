import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseTscOutput,
  resolveModuleRootForFile,
  resolveTypecheckTarget,
  runTypecheck,
} from "../../src/agent/typecheck.js";
import {
  TYPECHECK_CLEAN_MESSAGE,
  TYPECHECK_NO_TSCONFIG_MESSAGE,
  TYPECHECK_UNAVAILABLE_MESSAGE,
} from "../../src/constants/typecheck.js";

describe("parseTscOutput", () => {
  it("extracts error TS lines and counts them", () => {
    const out = [
      "src/a.ts(1,2): error TS2322: Type 'string' is not assignable to type 'X'.",
      "some unrelated line",
      "src/b.ts(3,4): error TS2345: Argument of type ...",
    ].join("\n");
    const { errorCount, summary } = parseTscOutput(out);
    expect(errorCount).toBe(2);
    expect(summary).toContain("error TS2322");
    expect(summary).toContain("error TS2345");
    expect(summary).not.toContain("unrelated");
  });

  it("returns zero when there are no diagnostic lines", () => {
    expect(parseTscOutput("all good\n").errorCount).toBe(0);
  });
});

describe("resolveModuleRootForFile", () => {
  const roots = ["/proj", "/proj/modules/dms-ai"];

  it("maps a file to the deepest containing root", () => {
    expect(
      resolveModuleRootForFile("/proj/modules/dms-ai/src/x.ts", roots),
    ).toBe("/proj/modules/dms-ai");
  });

  it("maps a host file to the host root", () => {
    expect(resolveModuleRootForFile("/proj/app/y.ts", roots)).toBe("/proj");
  });

  it("returns null for a file outside every root", () => {
    expect(resolveModuleRootForFile("/elsewhere/z.ts", roots)).toBeNull();
  });
});

describe("resolveTypecheckTarget", () => {
  const roots = ["/proj", "/proj/modules/dms-ai"];

  it("defaults to the module owning the last edited file", () => {
    const r = resolveTypecheckTarget(
      undefined,
      roots,
      "/proj/modules/dms-ai/src/x.ts",
      "/proj",
    );
    expect(r.root).toBe("/proj/modules/dms-ai");
  });

  it("defaults to the host root when there is no last edited file", () => {
    const r = resolveTypecheckTarget(undefined, roots, undefined, "/proj");
    expect(r.root).toBe("/proj");
  });

  it("resolves a target by directory basename", () => {
    const r = resolveTypecheckTarget("dms-ai", roots, undefined, "/proj");
    expect(r.root).toBe("/proj/modules/dms-ai");
  });

  it("rejects a target outside the known roots", () => {
    const r = resolveTypecheckTarget(
      "/somewhere/else",
      roots,
      undefined,
      "/proj",
    );
    expect(r.root).toBeNull();
    expect(r.knownTargets).toContain("dms-ai");
  });
});

describe("runTypecheck", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-tsc-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("no-ops when the target has no tsconfig", async () => {
    const result = await runTypecheck({
      targetRoot: dir,
      logger: { warn: () => {} },
    });
    expect(result.ran).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe(TYPECHECK_NO_TSCONFIG_MESSAGE);
  });

  it("reports a clean run when tsc exits zero", async () => {
    await writeFile(join(dir, "tsconfig.json"), "{}");
    const exec = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const result = await runTypecheck({ targetRoot: dir, exec });
    expect(result.ran).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe(TYPECHECK_CLEAN_MESSAGE);
  });

  it("reports type errors parsed from a non-zero tsc run", async () => {
    await writeFile(join(dir, "tsconfig.json"), "{}");
    const exec = vi.fn(async () => {
      throw {
        stdout: "src/a.ts(1,2): error TS2322: nope",
        stderr: "",
        code: 2,
      };
    });
    const result = await runTypecheck({ targetRoot: dir, exec });
    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.errorCount).toBe(1);
    expect(result.summary).toContain("error TS2322");
  });

  it("stays best-effort when tsc itself fails to run", async () => {
    await writeFile(join(dir, "tsconfig.json"), "{}");
    const exec = vi.fn(async () => {
      throw { stdout: "", stderr: "command not found: tsc", code: "ENOENT" };
    });
    const result = await runTypecheck({
      targetRoot: dir,
      exec,
      logger: { warn: () => {} },
    });
    expect(result.ran).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe(TYPECHECK_UNAVAILABLE_MESSAGE);
  });
});
