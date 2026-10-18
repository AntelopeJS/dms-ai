import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { XDG_CONFIG_HOME_ENV } from "../../src/constants/chatgpt.js";
import {
  type ChatGptAuthRecord,
  writeAuthRecord,
} from "../../src/providers/codex/chatgpt/store.js";

const HOUR_MS = 3_600_000;

/** A record whose token stays fresh for the whole run: no refresh is attempted. */
export function signedInRecord(): ChatGptAuthRecord {
  return {
    hostId: "urn:uuid:00000000-0000-4000-8000-000000000000",
    clientId: "oaiapp_test",
    subject: "user-test",
    email: "dev@example.com",
    tokens: {
      accessToken: "chatgpt-access-mock",
      refreshToken: "chatgpt-refresh-mock",
      idToken: "chatgpt-id-mock",
      expiresAt: Date.now() + 24 * HOUR_MS,
      scopes: ["openid", "chatgpt.tokens.use.direct"],
    },
  };
}

/**
 * Points the ChatGPT auth file at a fresh temporary config home, so no test
 * reads or writes the developer's real sign-in. Returns its removal.
 */
export function useTemporaryConfigHome(): () => void {
  const saved = process.env[XDG_CONFIG_HOME_ENV];
  const home = mkdtempSync(path.join(tmpdir(), "dms-ai-config-"));
  process.env[XDG_CONFIG_HOME_ENV] = home;
  return () => {
    if (saved === undefined) delete process.env[XDG_CONFIG_HOME_ENV];
    else process.env[XDG_CONFIG_HOME_ENV] = saved;
    rmSync(home, { recursive: true, force: true });
  };
}

export function signInForTests(): Promise<void> {
  return writeAuthRecord(signedInRecord());
}
