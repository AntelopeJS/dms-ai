import { describe, expect, it } from "vitest";
import {
  commandRulePrefix,
  detectDependencyChange,
  isCommandCovered,
} from "../../src/agent/command-analysis.js";

describe("dependency detection", () => {
  it.each([
    ["pnpm add jsvat", "adds_dependency", "pnpm-lock.yaml"],
    ["npm install left-pad", "adds_dependency", "package-lock.json"],
    ["yarn remove lodash", "removes_dependency", "yarn.lock"],
    [
      "cd app && pnpm --filter web add -D vitest",
      "adds_dependency",
      "pnpm-lock.yaml",
    ],
    ["bun rm zod", "removes_dependency", "bun.lock"],
  ])("%s", (command, effect, lockfile) => {
    expect(detectDependencyChange(command)).toEqual({
      effect,
      touches: ["package.json", lockfile],
    });
  });

  it.each(["pnpm install", "npm i", "pnpm test", "git add ."])(
    "%s changes no dependency",
    (command) => {
      expect(detectDependencyChange(command)).toBeNull();
    },
  );
});

describe("command rules", () => {
  it("keeps the first two words of a simple command", () => {
    expect(commandRulePrefix("pnpm test --run")).toBe("pnpm test");
    expect(commandRulePrefix("ls")).toBe("ls");
  });

  it("offers no rule for a compound or redirected command", () => {
    expect(commandRulePrefix("pnpm test && rm -rf x")).toBeNull();
    expect(commandRulePrefix("echo $(whoami)")).toBeNull();
  });

  it("covers a command only when every segment matches", () => {
    expect(isCommandCovered("pnpm test unit", ["pnpm test"])).toBe(true);
    expect(isCommandCovered("pnpm testing", ["pnpm test"])).toBe(false);
    expect(isCommandCovered("pnpm test; ls -la", ["pnpm test", "ls -la"])).toBe(
      true,
    );
    expect(isCommandCovered("pnpm test; rm -rf /", ["pnpm test"])).toBe(false);
    expect(isCommandCovered("pnpm test > out", ["pnpm test"])).toBe(false);
  });
});
