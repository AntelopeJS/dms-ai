import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { SetSettingsMsg } from "../../src/protocol/messages.js";
import {
  mergeSettings,
  parseSettings,
} from "../../src/state/settings-store.js";

const KEPT_LEGACY_MODES = ["acceptEdits", "plan"] as const;

interface StoredFile {
  mode?: string;
  defaultModes?: ModesBody;
}

interface ModesBody {
  claude?: string;
  codex?: string;
}

function storedModes(stored: StoredFile) {
  return parseSettings(JSON.stringify(stored)).defaultModes;
}

describe("v2 settings", () => {
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
      defaultModes: { codex: "auto" },
    });
    expect(merged).toMatchObject({
      requestTimeoutMinutes: 15,
      checkpointRetentionDays: 30,
      defaultModes: { claude: "auto", codex: "normal" },
    });
  });
});

describe("default mode per provider", () => {
  it("starts a fresh install in Auto review on Claude Code and Ask first on Codex", () => {
    expect(storedModes({})).toEqual({ claude: "auto", codex: "normal" });
  });

  it.each(KEPT_LEGACY_MODES)(
    "keeps a mode saved before the default was per provider (%s) on both providers",
    (mode) => {
      expect(storedModes({ mode })).toEqual({ claude: mode, codex: mode });
    },
  );

  it("reads a legacy normal, written back by every old settings save, as no mode chosen", () => {
    expect(storedModes({ mode: "normal" })).toEqual({
      claude: "auto",
      codex: "normal",
    });
  });

  it("keeps Ask first on Claude Code when a per-provider file chooses it", () => {
    expect(storedModes({ defaultModes: { claude: "normal" } })).toEqual({
      claude: "normal",
      codex: "normal",
    });
  });

  it("gives a file saved after the migration back unchanged, never flipping to the older value", () => {
    const migrated = parseSettings(JSON.stringify({ mode: "normal" }));
    const saved = JSON.stringify(migrated);
    expect(JSON.parse(saved)).not.toHaveProperty("mode");
    expect(parseSettings(saved)).toEqual(migrated);

    const chosen = mergeSettings(migrated, {
      defaultModes: { claude: "normal" },
    });
    expect(parseSettings(JSON.stringify(chosen)).defaultModes).toEqual({
      claude: "normal",
      codex: "normal",
    });
  });

  it("reads a stored global auto, the Full auto of an older version, as Ask first on both", () => {
    expect(storedModes({ mode: "auto" })).toEqual({
      claude: "normal",
      codex: "normal",
    });
  });

  it("takes a saved mode it does not know for nothing saved", () => {
    expect(storedModes({ mode: "turbo" })).toEqual(
      DEFAULT_SETTINGS.defaultModes,
    );
  });

  it("lets a provider's own saved default win over the older global mode", () => {
    expect(
      storedModes({ mode: "plan", defaultModes: { claude: "auto" } }),
    ).toEqual({ claude: "auto", codex: "plan" });
  });

  it("refuses Auto review on Codex in the file and keeps Claude Code's default", () => {
    expect(
      storedModes({ defaultModes: { claude: "plan", codex: "auto" } }),
    ).toEqual({ claude: "plan", codex: "normal" });
  });

  it("changes one provider's default without touching the other's", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      defaultModes: { claude: "acceptEdits", codex: "acceptEdits" },
    } as const;
    expect(
      mergeSettings(current, { defaultModes: { codex: "plan" } }).defaultModes,
    ).toEqual({ claude: "acceptEdits", codex: "plan" });
    expect(
      mergeSettings(current, { defaultModes: { claude: "auto" } }).defaultModes,
    ).toEqual({ claude: "auto", codex: "acceptEdits" });
  });

  it("refuses Auto review on Codex from the chat, and takes it on Claude Code", () => {
    const parse = (defaultModes: ModesBody) =>
      SetSettingsMsg.safeParse({ type: "set_settings", defaultModes }).success;
    expect(parse({ codex: "auto" })).toBe(false);
    expect(parse({ claude: "auto" })).toBe(true);
  });
});
