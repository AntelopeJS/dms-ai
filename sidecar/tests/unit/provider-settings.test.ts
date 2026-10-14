import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { SetSettingsMsg } from "../../src/protocol/messages.js";
import { getProviderAvailability } from "../../src/providers/registry.js";
import type { ProviderAvailability } from "../../src/providers/types.js";
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

  it("falls back to the default when the stored file omits it", () => {
    const partial = JSON.stringify({ mode: "plan", thinking: "low" });
    expect(parseSettings(partial).provider).toBe(DEFAULT_SETTINGS.provider);
  });

  it("rejects an unknown provider name in the stored file", () => {
    const bogus = JSON.stringify({ provider: "gemini", mode: "normal" });
    expect(parseSettings(bogus).provider).toBe(DEFAULT_SETTINGS.provider);
  });

  // A settings patch omitting the field must leave the stored choice alone.
  it("leaves the field undefined when a patch omits it", () => {
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
    const verdicts: ProviderAvailability[] = Object.values(
      getProviderAvailability(),
    );
    for (const verdict of verdicts) {
      if (verdict.available) continue;
      expect(verdict.reason).toBeTypeOf("string");
    }
  });

  it("can always drive Claude, which ships with the sidecar", () => {
    expect(getProviderAvailability().claude.available).toBe(true);
  });
});
