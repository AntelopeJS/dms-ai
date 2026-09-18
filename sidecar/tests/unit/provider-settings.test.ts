import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { AppSettingsSchema } from "../../src/protocol/events.js";
import { SetSettingsMsg } from "../../src/protocol/messages.js";
import { getProviderAvailability } from "../../src/providers/availability.js";
import { parseSettings } from "../../src/state/settings-store.js";
import { PROVIDER_NAMES } from "../../src/state/types.js";

const STORED_CODEX = JSON.stringify({
  provider: "codex",
  mode: "normal",
  thinking: "medium",
  generationMode: "safe",
  allowLocalSkills: false,
});

describe("provider setting", () => {
  it("round-trips through the settings file", () => {
    expect(parseSettings(STORED_CODEX).provider).toBe("codex");
  });

  it("falls back to the default on a transcript written before it existed", () => {
    const legacy = JSON.stringify({ mode: "plan", thinking: "low" });
    expect(parseSettings(legacy).provider).toBe(DEFAULT_SETTINGS.provider);
  });

  it("rejects an unknown provider name in the stored file", () => {
    const bogus = JSON.stringify({ provider: "gemini", mode: "normal" });
    expect(parseSettings(bogus).provider).toBe(DEFAULT_SETTINGS.provider);
  });

  // An older client omitting the field must not silently downgrade the choice,
  // so the schemas leave it undefined instead of defaulting it.
  it("leaves the field undefined when a client omits it", () => {
    const parsed = AppSettingsSchema.parse({
      mode: "normal",
      thinking: "medium",
    });
    expect(parsed.provider).toBeUndefined();
    const msg = SetSettingsMsg.parse({
      type: "set_settings",
      mode: "normal",
      thinking: "medium",
    });
    expect(msg.provider).toBeUndefined();
  });

  it("accepts the field when a client sends it", () => {
    const msg = SetSettingsMsg.parse({
      type: "set_settings",
      provider: "codex",
      mode: "normal",
      thinking: "medium",
    });
    expect(msg.provider).toBe("codex");
  });
});

describe("provider availability", () => {
  it("reports a verdict for every known provider", () => {
    const availability = getProviderAvailability();
    expect(Object.keys(availability).sort()).toEqual(
      [...PROVIDER_NAMES].sort(),
    );
  });

  it("carries a reason on anything it cannot drive", () => {
    for (const verdict of Object.values(getProviderAvailability())) {
      if (verdict.available) continue;
      expect(verdict.reason).toBeTypeOf("string");
    }
  });

  it("can always drive Claude, which ships with the sidecar", () => {
    expect(getProviderAvailability().claude.available).toBe(true);
  });
});
