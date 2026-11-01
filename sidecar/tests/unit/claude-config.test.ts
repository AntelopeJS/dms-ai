import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { resolveModelOptions } from "../../src/providers/claude/config.js";
import { parseSettings } from "../../src/state/settings-store.js";
import type { AppSettings } from "../../src/state/settings-types.js";

function settings(overrides: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("claude model options", () => {
  it("defaults to Opus 5.5 at medium effort", () => {
    expect(resolveModelOptions(DEFAULT_SETTINGS)).toEqual({
      model: "claude-opus-5-5",
      thinking: { type: "adaptive" },
      effort: "medium",
    });
  });

  it("maps each thinking level to the same effort level", () => {
    expect(resolveModelOptions(settings({ thinking: "low" })).effort).toBe(
      "low",
    );
    expect(resolveModelOptions(settings({ thinking: "high" })).effort).toBe(
      "high",
    );
  });

  it("disables thinking and sends no effort when thinking is off", () => {
    const options = resolveModelOptions(settings({ thinking: "off" }));
    expect(options.thinking).toEqual({ type: "disabled" });
    expect(options.effort).toBeUndefined();
  });

  it("passes the configured model through", () => {
    const options = resolveModelOptions(
      settings({ claudeModel: "claude-sonnet-4-6" }),
    );
    expect(options.model).toBe("claude-sonnet-4-6");
  });

  it("keeps the default model when the stored file omits or blanks it", () => {
    expect(parseSettings("{}").claudeModel).toBe("claude-opus-5-5");
    expect(parseSettings('{"claudeModel":"  "}').claudeModel).toBe(
      "claude-opus-5-5",
    );
    expect(
      parseSettings('{"claudeModel":"claude-haiku-4-5"}').claudeModel,
    ).toBe("claude-haiku-4-5");
  });
});
