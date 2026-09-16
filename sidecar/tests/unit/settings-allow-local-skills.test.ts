import { describe, expect, it } from "vitest";
import { parseSettings } from "../../src/state/settings-store.js";

describe("parseSettings allowLocalSkills", () => {
  it("defaults to false when absent", () => {
    expect(parseSettings("{}").allowLocalSkills).toBe(false);
  });
  it("accepts an explicit true", () => {
    expect(
      parseSettings(JSON.stringify({ allowLocalSkills: true }))
        .allowLocalSkills,
    ).toBe(true);
  });
  it("coerces non-boolean to false", () => {
    expect(
      parseSettings(JSON.stringify({ allowLocalSkills: "yes" }))
        .allowLocalSkills,
    ).toBe(false);
  });
});
