import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLATFORM_LINUX } from "../../src/constants/native-binary.js";
import { bundledBwrapDirectory } from "../../src/providers/codex/bundled-bwrap.js";

let install: string;

function codexBinary(bundledBwrapScript?: string): string {
  mkdirSync(join(install, "bin"));
  writeFileSync(join(install, "bin", "codex"), "");
  if (bundledBwrapScript !== undefined) {
    mkdirSync(join(install, "codex-resources"));
    writeFileSync(
      join(install, "codex-resources", "bwrap"),
      bundledBwrapScript,
      {
        mode: 0o755,
      },
    );
  }
  return join(install, "bin", "codex");
}

beforeEach(() => {
  install = mkdtempSync(join(tmpdir(), "dms-ai-codex-install-"));
});

afterEach(() => {
  rmSync(install, { recursive: true, force: true });
});

describe.skipIf(process.platform !== PLATFORM_LINUX)(
  "bundled bubblewrap",
  () => {
    it("puts a copy of the bundled one first, outside the Codex install", () => {
      const directory = bundledBwrapDirectory(
        codexBinary("#!/bin/sh\necho bundled\n"),
      );

      expect(directory).toBeDefined();
      expect(directory?.startsWith(install)).toBe(false);
      const ran = spawnSync(join(directory ?? "", "bwrap"), {
        encoding: "utf8",
      });
      expect(ran.stdout).toBe("bundled\n");
    });

    it("leaves PATH alone when the bundled one cannot create a namespace here", () => {
      expect(
        bundledBwrapDirectory(codexBinary("#!/bin/sh\nexit 1\n")),
      ).toBeUndefined();
    });

    it("leaves PATH alone when Codex ships none", () => {
      expect(bundledBwrapDirectory(codexBinary())).toBeUndefined();
    });
  },
);
