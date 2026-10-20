import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/agent/system-prompt.js";
import { SAFE_MODE_SKILL_NAME } from "../../src/constants/codex.js";

const BEST_PRACTICES_SKILL = "dms-best-practices";
const CODE_MODE_SKILL = "dms-ai-code-mode";

describe("system prompt", () => {
  const prompt = buildSystemPrompt({ hostProjectRoot: "/srv/app" });

  it("sends the agent to the page skills before it edits a page", () => {
    const loopStep = prompt
      .split("\n")
      .find((line) => line.includes(BEST_PRACTICES_SKILL));
    expect(loopStep).toMatch(/^1\. /);
    expect(loopStep).toContain(CODE_MODE_SKILL);
    expect(loopStep).toContain(SAFE_MODE_SKILL_NAME);
  });

  it("names each skill once per decision point", () => {
    expect(prompt.split(BEST_PRACTICES_SKILL)).toHaveLength(2);
    expect(prompt.split(CODE_MODE_SKILL)).toHaveLength(2);
  });
});
