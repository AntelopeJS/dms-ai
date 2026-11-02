import { matchesGlob } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SECRET_FILE_NAME_PREFIX,
  SECRET_FILE_TEMPLATE_NAMES,
} from "../../src/constants/project-secrets.js";
import { SECRET_FILE_GLOBS } from "../../src/providers/codex/secret-file-globs.js";

function isDenied(name: string): boolean {
  return SECRET_FILE_GLOBS.some((glob) => matchesGlob(name, glob));
}

const TEMPLATES = [...SECRET_FILE_TEMPLATE_NAMES];

function nearTemplates(template: string): string[] {
  const start = SECRET_FILE_NAME_PREFIX.length;
  const cuts = Array.from({ length: template.length - start }, (_, index) =>
    template.slice(0, start + index),
  );
  const swaps = Array.from(
    { length: template.length - start },
    (_, index) =>
      `${template.slice(0, start + index)}q${template.slice(start + index + 1)}`,
  );
  return [...cuts, `${template}x`, ...swaps];
}

describe("secret file globs", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.production",
    ".env.staging",
    ".env.test",
    ".env.secret",
    ".ENV",
    ".Env.Local",
    ".env.examples",
    ".env.sample.bak",
  ])("deny %s", (name) => {
    expect(isDenied(name)).toBe(true);
  });

  it.each([
    ...TEMPLATES,
    ".ENV.EXAMPLE",
    ".Env.Template",
    ".envrc",
    ".environment",
    "env",
    "app.env",
    ".env-local",
  ])("let %s through", (name) => {
    expect(isDenied(name)).toBe(false);
  });

  it("deny every name a letter away from a template", () => {
    const missed = TEMPLATES.flatMap(nearTemplates).filter(
      (name) => !isDenied(name),
    );
    expect(missed).toEqual([]);
  });
});
