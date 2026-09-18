import { afterEach, describe, expect, it } from "vitest";
import {
  MOCK_CODEX_VERSION,
  MOCK_CODEX_VERSION_ENV,
} from "../../src/constants/codex.js";
import { PROVIDER_UNAVAILABLE_REASONS } from "../../src/constants/providers.js";
import { getProviderAvailability } from "../../src/providers/availability.js";
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
    CODEX_FIXTURE.reset();
  });

  it("reads the version the binary reports", () => {
    CODEX_FIXTURE.use("plain");
    expect(readCodexBinaryVersion(installation().binaryPath)).toBe(
      MOCK_CODEX_VERSION,
    );
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

  it("reports the drift as the reason the provider is unavailable", () => {
    CODEX_FIXTURE.use("plain");
    process.env[MOCK_CODEX_VERSION_ENV] = DRIFTED_VERSION;
    expect(getProviderAvailability().codex).toEqual({
      available: false,
      reason: PROVIDER_UNAVAILABLE_REASONS.CODEX_VERSION_MISMATCH,
    });
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
