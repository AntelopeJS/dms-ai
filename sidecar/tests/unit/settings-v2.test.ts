import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { SetSettingsMsg } from "../../src/protocol/messages.js";
import {
  mergeSettings,
  parseSettings,
} from "../../src/state/settings-store.js";

describe("v2 settings", () => {
  it("reads a stored global auto mode as normal", () => {
    expect(parseSettings(JSON.stringify({ mode: "auto" })).mode).toBe("normal");
  });

  it("defaults every new field", () => {
    expect(parseSettings("{}")).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({
      alwaysAskDependencies: true,
      alwaysAskBlockRemoval: true,
      requestTimeoutMinutes: 5,
      notifyRequests: true,
      checkpointRetentionDays: 30,
    });
  });

  it("merges a partial change and keeps what it does not accept", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      requestTimeoutMinutes: 15,
      checkpointRetentionDays: 12,
      mode: "auto",
    });
    expect(merged).toMatchObject({
      requestTimeoutMinutes: 15,
      checkpointRetentionDays: 30,
      mode: "normal",
    });
  });

  it("refuses auto from the chat", () => {
    expect(
      SetSettingsMsg.safeParse({ type: "set_settings", mode: "auto" }).success,
    ).toBe(false);
    expect(
      SetSettingsMsg.safeParse({ type: "set_settings", notifyRequests: false })
        .success,
    ).toBe(true);
  });
});
