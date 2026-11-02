import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isSecretFile,
  reachesSecretFile,
} from "../../src/agent/project-secrets.js";

describe("isSecretFile", () => {
  it.each([".env", ".env.local", ".env.production", ".env.development.local"])(
    "calls %s a secret file, so a rule that only matches the exact name .env misses none of the variants",
    (name) => {
      expect(isSecretFile(name)).toBe(true);
    },
  );

  it.each([".env.example", ".env.sample", ".env.template"])(
    "lets the committed template %s through, which the agent needs to learn the variable names",
    (name) => {
      expect(isSecretFile(name)).toBe(false);
    },
  );

  it("ignores case, since Windows and macOS file systems do", () => {
    expect(isSecretFile(".ENV")).toBe(true);
    expect(isSecretFile(".Env.Local")).toBe(true);
    expect(isSecretFile(".ENV.EXAMPLE")).toBe(false);
  });

  it.each([
    "/srv/app/.env",
    "../x/.env",
    "modules/a/.env.local",
    "/proc/self/cwd/.env",
    "C:\\srv\\app\\.env",
  ])(
    "judges %s by its file name, so a rule that only looks at the project root's .env misses none",
    (path) => {
      expect(isSecretFile(path)).toBe(true);
    },
  );

  it.each([
    "/srv/app/.env.example",
    "modules/a/.env.sample",
    "C:\\srv\\app\\.env.template",
  ])("keeps the template exception for the nested path %s", (path) => {
    expect(isSecretFile(path)).toBe(false);
  });

  it.each([
    "src/env.ts",
    ".envrc",
    "env",
    ".environment",
    "my.env",
    "/srv/.env/config.json",
    "notes.env.md",
    "",
  ])(
    "does not call %s a secret file, so a substring match does not block ordinary files",
    (path) => {
      expect(isSecretFile(path)).toBe(false);
    },
  );
});

describe("reachesSecretFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-reaches-secret-"));
    await writeFile(join(dir, ".env"), "TOKEN=canary\n");
    await writeFile(join(dir, ".env.example"), "TOKEN=\n");
    await writeFile(join(dir, "notes.txt"), "plain\n");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a link to .env, since the link's own name hides it", async () => {
    await symlink(".env", join(dir, "config.txt"));
    expect(await reachesSecretFile("config.txt", dir)).toBe(true);
    expect(await reachesSecretFile(join(dir, "config.txt"), "/")).toBe(true);
  });

  it("refuses a chain of links that ends at .env", async () => {
    await symlink(".env", join(dir, "first.txt"));
    await symlink("first.txt", join(dir, "second.txt"));
    expect(await reachesSecretFile("second.txt", dir)).toBe(true);
  });

  it("refuses a link under another directory that reaches .env", async () => {
    await mkdir(join(dir, "sub"));
    await symlink("../.env", join(dir, "sub", "settings.txt"));
    expect(await reachesSecretFile("sub/settings.txt", dir)).toBe(true);
  });

  it("allows a link to the committed .env.example", async () => {
    await symlink(".env.example", join(dir, "template.txt"));
    expect(await reachesSecretFile("template.txt", dir)).toBe(false);
  });

  it("allows a link to an ordinary file and the file itself", async () => {
    await symlink("notes.txt", join(dir, "alias.txt"));
    expect(await reachesSecretFile("alias.txt", dir)).toBe(false);
    expect(await reachesSecretFile("notes.txt", dir)).toBe(false);
  });

  it("keeps the name rule for a path that does not exist yet", async () => {
    expect(await reachesSecretFile(".env.local", dir)).toBe(true);
    expect(await reachesSecretFile("missing/.env", dir)).toBe(true);
    expect(await reachesSecretFile("missing.txt", dir)).toBe(false);
    expect(await reachesSecretFile(".env.example.bak", dir)).toBe(true);
  });

  it("refuses a path that cannot be resolved for a reason other than not found", async () => {
    await symlink("loop-b.txt", join(dir, "loop-a.txt"));
    await symlink("loop-a.txt", join(dir, "loop-b.txt"));
    expect(await reachesSecretFile("loop-a.txt", dir)).toBe(true);
  });
});
