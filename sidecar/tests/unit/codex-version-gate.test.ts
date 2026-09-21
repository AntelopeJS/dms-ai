import { afterEach, describe, expect, it } from "vitest";
import {
  CODEX_VERSION_WAIVER_ENABLED,
  CODEX_VERSION_WAIVER_ENV,
  MOCK_CODEX_VERSION,
  MOCK_CODEX_VERSION_ENV,
} from "../../src/constants/codex.js";
import {
  PROVIDER_INSTALLED_VERSION_TOKEN,
  PROVIDER_PINNED_VERSION_TOKEN,
  PROVIDER_UNAVAILABLE_REASONS,
} from "../../src/constants/providers.js";
import { getProviderAvailability } from "../../src/providers/registry.js";
import {
  isCodexInstallationUsable,
  readCodexBinaryVersion,
  resolveCodexInstallation,
} from "../../src/providers/codex/resolve-binary.js";
import { CODEX_FIXTURE } from "../helpers/provider-fixtures.js";

const DRIFTED_VERSION = "1.2.3";

function installation() {
  const resolved = resolveCodexInstallation();
  if (resolved === undefined) throw new Error("mock codex did not resolve");
  return resolved;
}

// Codex versions its app-server protocol by binary and ships about ten releases
// a month, so a binary that does not match the generated types is refused at
// spawn rather than left to break in production.
describe("codex binary version gate", () => {
  afterEach(() => {
    delete process.env[MOCK_CODEX_VERSION_ENV];
    delete process.env[CODEX_VERSION_WAIVER_ENV];
    CODEX_FIXTURE.reset();
  });

  it("reads the version the binary reports", () => {
    CODEX_FIXTURE.use("plain");
    expect(readCodexBinaryVersion(installation())).toBe(MOCK_CODEX_VERSION);
  });

  it("accepts a binary matching the pinned types", () => {
    CODEX_FIXTURE.use("plain");
    expect(isCodexInstallationUsable(installation())).toBe(true);
  });

  it("refuses a binary whose version drifted from the types", () => {
    CODEX_FIXTURE.use("plain");
    process.env[MOCK_CODEX_VERSION_ENV] = DRIFTED_VERSION;
    expect(isCodexInstallationUsable(installation())).toBe(false);
  });

  // The mismatch is the expected state after any Codex upgrade, so the reason
  // has to say which version is installed and which one to pin back to.
  it("names both versions in the reason the provider is unavailable", () => {
    CODEX_FIXTURE.use("plain");
    process.env[MOCK_CODEX_VERSION_ENV] = DRIFTED_VERSION;
    const verdict = getProviderAvailability().codex;
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toContain(DRIFTED_VERSION);
    expect(verdict.reason).toContain(MOCK_CODEX_VERSION);
    expect(verdict.reason).not.toContain(PROVIDER_PINNED_VERSION_TOKEN);
    expect(verdict.reason).not.toContain(PROVIDER_INSTALLED_VERSION_TOKEN);
  });

  it("lets an explicit waiver through, so a newer binary is not a dead end", () => {
    CODEX_FIXTURE.use("plain");
    process.env[MOCK_CODEX_VERSION_ENV] = DRIFTED_VERSION;
    process.env[CODEX_VERSION_WAIVER_ENV] = CODEX_VERSION_WAIVER_ENABLED;
    expect(isCodexInstallationUsable(installation())).toBe(true);
  });

  it("reports a missing API key as its own reason", () => {
    CODEX_FIXTURE.use("plain");
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(getProviderAvailability().codex).toEqual({
        available: false,
        reason: PROVIDER_UNAVAILABLE_REASONS.CODEX_API_KEY_MISSING,
      });
    } finally {
      if (key !== undefined) process.env.OPENAI_API_KEY = key;
    }
  });
});
