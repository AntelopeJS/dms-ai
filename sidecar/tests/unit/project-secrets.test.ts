import { describe, expect, it } from "vitest";
import { isSecretFile } from "../../src/agent/project-secrets.js";

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
