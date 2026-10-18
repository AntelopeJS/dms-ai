import {
  CHATGPT_LOG_PREFIX,
  CHATGPT_NOT_SIGNED_IN_MESSAGE,
  CHATGPT_REFRESH_MARGIN_MS,
  CHATGPT_SIGNED_OUT_MESSAGE,
} from "../../../constants/chatgpt.js";
import { withAuthLock } from "./lock.js";
import {
  ChatGptOAuthError,
  refreshTokens,
  revokeRefreshToken,
} from "./oauth.js";
import {
  type ChatGptAuthRecord,
  type ChatGptTokens,
  isSignedIn,
  readAuthRecord,
  writeAuthRecord,
} from "./store.js";

/** What the Settings page shows about the ChatGPT account. */
export interface ChatGptAccountStatus {
  isSignedIn: boolean;
  email?: string;
}

export function readAccountStatus(): ChatGptAccountStatus {
  const record = readAuthRecord();
  if (!isSignedIn(record)) return { isSignedIn: false };
  return { isSignedIn: true, email: record?.email };
}

function isFresh(tokens: ChatGptTokens): boolean {
  return tokens.expiresAt - Date.now() > CHATGPT_REFRESH_MARGIN_MS;
}

function withoutTokens(record: ChatGptAuthRecord): ChatGptAuthRecord {
  const { tokens: _cleared, ...rest } = record;
  return rest;
}

// Runs under the machine-wide lock, so the record read here is the latest one:
// another sidecar may have refreshed while this one waited, in which case its
// token is used rather than spending the rotated-away refresh token.
async function refreshLocked(): Promise<string> {
  const record = readAuthRecord();
  if (record?.tokens === undefined || record.clientId === undefined) {
    throw new Error(CHATGPT_NOT_SIGNED_IN_MESSAGE);
  }
  if (isFresh(record.tokens)) return record.tokens.accessToken;
  try {
    const tokens = await refreshTokens(record.clientId, record.tokens);
    await writeAuthRecord({ ...record, tokens });
    return tokens.accessToken;
  } catch (error) {
    if (!(error instanceof ChatGptOAuthError) || !error.isTerminal) throw error;
    // Unusable for good: forgetting it is what makes the provider report
    // "sign in again" instead of failing every turn the same way.
    console.warn(`${CHATGPT_LOG_PREFIX} sign-in dropped: ${error.message}`);
    await writeAuthRecord(withoutTokens(record));
    throw new Error(CHATGPT_SIGNED_OUT_MESSAGE);
  }
}

let refreshing: Promise<string> | null = null;

/**
 * A ChatGPT access token valid for at least CHATGPT_REFRESH_MARGIN_MS, refreshed
 * first when it is not. Rejects when no account is signed in, or when the
 * sign-in can no longer be refreshed (and is then forgotten).
 */
export async function getAccessToken(): Promise<string> {
  const record = readAuthRecord();
  if (record?.tokens === undefined || !isSignedIn(record)) {
    throw new Error(CHATGPT_NOT_SIGNED_IN_MESSAGE);
  }
  if (isFresh(record.tokens)) return record.tokens.accessToken;
  // One refresh per sidecar at a time; the lock orders it against the others.
  refreshing ??= withAuthLock(refreshLocked).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Outcome of a sign-out: whether OpenAI confirmed the session is revoked. */
export interface SignOutResult {
  isRevoked: boolean;
}

/**
 * Revokes the session, then forgets its tokens. The host id and the issued
 * client id are kept for the next sign-in on this machine.
 */
export function signOut(): Promise<SignOutResult> {
  return withAuthLock(async () => {
    const record = readAuthRecord();
    if (record?.tokens === undefined) return { isRevoked: true };
    const isRevoked =
      record.clientId === undefined
        ? false
        : await revokeRefreshToken(record.clientId, record.tokens.refreshToken);
    await writeAuthRecord(withoutTokens(record));
    return { isRevoked };
  });
}
