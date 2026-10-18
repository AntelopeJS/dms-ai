import {
  CHATGPT_CALLBACK_PATH,
  CHATGPT_DYNAMIC_CLIENT_ID,
  CHATGPT_LOG_PREFIX,
  CHATGPT_LOGIN_TTL_MS,
  CHATGPT_MAX_PENDING_ATTEMPTS,
  CHATGPT_PLAN_SCOPE,
} from "../../../constants/chatgpt.js";
import { HTTP_STATUS } from "../../../constants/http.js";
import { LOOPBACK_HOST } from "../../../constants/ports.js";
import { withAuthLock } from "./lock.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  randomUrlSafe,
  validateIdToken,
} from "./oauth.js";
import {
  type ChatGptAuthRecord,
  readAuthRecord,
  readOrCreateAuthRecord,
  writeAuthRecord,
} from "./store.js";

/** One authorization in flight, found again by its `state` on return. */
interface PendingAttempt {
  clientId?: string;
  hostId: string;
  redirectUri: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
}

/** What the callback answers: a page for the user, or the same as JSON. */
export interface LoginResponse {
  status: number;
  title: string;
  message: string;
}

const attempts = new Map<string, PendingAttempt>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [state, attempt] of attempts) {
    if (attempt.expiresAt <= now) attempts.delete(state);
  }
  // Oldest first: a Map keeps insertion order.
  while (attempts.size > CHATGPT_MAX_PENDING_ATTEMPTS) {
    const oldest = attempts.keys().next();
    if (oldest.done === true) return;
    attempts.delete(oldest.value);
  }
}

function page(status: number, title: string, message: string): LoginResponse {
  return { status, title, message };
}

const EXPIRED_LINK = page(
  HTTP_STATUS.BAD_REQUEST,
  "This sign-in link has expired",
  "Go back to Assistant › Settings in the dashboard and press “Sign in with ChatGPT” again.",
);

// The host id has to be stable before the first authorization: it is what
// OpenAI binds the registration to.
async function ensureRecord(): Promise<ChatGptAuthRecord> {
  const existing = readAuthRecord();
  if (existing !== undefined) return existing;
  const created = readOrCreateAuthRecord();
  await writeAuthRecord(created);
  return created;
}

/**
 * Opens a sign-in attempt and answers OpenAI's authorization URL, which the
 * Settings page links to directly: the browser reaches OpenAI wherever the
 * dashboard runs. The way back is the sidecar's loopback callback, which only
 * a browser on the sidecar's machine reaches; anywhere else, the user pastes
 * the address it could not load (see `finishPastedLogin`).
 */
export async function createLoginUrl(port: number): Promise<string> {
  sweepExpired();
  const record = await withAuthLock(ensureRecord);
  const state = randomUrlSafe();
  const attempt: PendingAttempt = {
    clientId: record.clientId,
    hostId: record.hostId,
    redirectUri: `http://${LOOPBACK_HOST}:${port}${CHATGPT_CALLBACK_PATH}`,
    nonce: randomUrlSafe(),
    codeVerifier: randomUrlSafe(),
    expiresAt: Date.now() + CHATGPT_LOGIN_TTL_MS,
  };
  attempts.set(state, attempt);
  return buildAuthorizeUrl({
    ...attempt,
    state,
    idTokenHint:
      record.clientId === undefined ? undefined : record.tokens?.idToken,
    loginHint: record.clientId === undefined ? undefined : record.email,
  });
}

/**
 * The client id this sign-in is for: the one a registration just issued, or
 * the one already stored. A registration without one is incomplete, and a
 * reauthorization answered with another one is not ours.
 */
function resolveClientId(
  attempt: PendingAttempt,
  returned: string | null,
): string | undefined {
  if (attempt.clientId === undefined) {
    if (returned === null || returned === CHATGPT_DYNAMIC_CLIENT_ID)
      return undefined;
    return returned;
  }
  if (returned !== null && returned !== attempt.clientId) return undefined;
  return attempt.clientId;
}

async function completeLogin(
  attempt: PendingAttempt,
  clientId: string,
  code: string,
): Promise<LoginResponse> {
  const tokens = await exchangeCode({
    clientId,
    code,
    codeVerifier: attempt.codeVerifier,
    redirectUri: attempt.redirectUri,
  });
  if (!tokens.scopes.includes(CHATGPT_PLAN_SCOPE)) {
    return page(
      HTTP_STATUS.FORBIDDEN,
      "ChatGPT plan usage was not granted",
      "Codex runs on your ChatGPT plan. Sign in again and allow plan usage, or check that your plan includes it.",
    );
  }
  const claims = await validateIdToken(tokens.idToken, {
    clientId,
    nonce: attempt.nonce,
  });
  return withAuthLock(async () => {
    const record = readOrCreateAuthRecord();
    const isOtherAccount =
      record.subject !== undefined &&
      record.clientId === clientId &&
      record.subject !== claims.sub;
    if (isOtherAccount) {
      // The client id is bound to the account that registered it. Forgetting
      // it lets the next attempt register this account instead.
      await writeAuthRecord({ hostId: record.hostId });
      return page(
        HTTP_STATUS.CONFLICT,
        "A different ChatGPT account",
        "This machine was registered with another ChatGPT account. Press “Sign in with ChatGPT” again to register this one.",
      );
    }
    await writeAuthRecord({
      hostId: record.hostId,
      clientId,
      subject: claims.sub,
      email: claims.email,
      tokens,
    });
    const who = claims.email === undefined ? "" : ` as ${claims.email}`;
    return page(
      HTTP_STATUS.OK,
      "Signed in with ChatGPT",
      `Codex now runs on your ChatGPT plan${who}. You can close this tab and go back to the dashboard.`,
    );
  });
}

/** GET /auth/chatgpt/callback: where OpenAI sends the browser back. */
export async function finishLogin(
  query: URLSearchParams,
): Promise<LoginResponse> {
  sweepExpired();
  const state = query.get("state");
  const attempt = state === null ? undefined : attempts.get(state);
  if (state === null || attempt === undefined) return EXPIRED_LINK;
  attempts.delete(state);
  const error = query.get("error");
  if (error !== null) {
    return page(
      HTTP_STATUS.BAD_REQUEST,
      "Sign-in cancelled",
      error === "access_denied"
        ? "Nothing was changed. Codex stays signed out."
        : `OpenAI answered “${error}”. Nothing was changed.`,
    );
  }
  const code = query.get("code");
  const clientId = resolveClientId(attempt, query.get("client_id"));
  if (code === null || clientId === undefined) {
    return page(
      HTTP_STATUS.BAD_REQUEST,
      "Sign-in incomplete",
      "OpenAI did not finish the registration. Try again from Assistant › Settings.",
    );
  }
  try {
    return await completeLogin(attempt, clientId, code);
  } catch (failure) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    console.error(`${CHATGPT_LOG_PREFIX} sign-in failed: ${reason}`);
    return page(
      HTTP_STATUS.BAD_GATEWAY,
      "Sign-in failed",
      `${reason}. Try again from Assistant › Settings.`,
    );
  }
}

const NOT_A_CALLBACK = page(
  HTTP_STATUS.BAD_REQUEST,
  "Not the sign-in address",
  "Paste the whole address of the page OpenAI sent you to, starting with http://127.0.0.1.",
);

/**
 * The same as the callback, for an address the user pasted: OpenAI's redirect
 * to 127.0.0.1 lands on the user's own machine when the DMS runs elsewhere, so
 * the browser shows an error page whose address still carries the code. Only
 * this sidecar holds the PKCE verifier the code is exchanged with, so the
 * address is useless to anyone it leaks to once used or expired.
 */
export function finishPastedLogin(pasted: string): Promise<LoginResponse> {
  let url: URL;
  try {
    url = new URL(pasted.trim());
  } catch {
    return Promise.resolve(NOT_A_CALLBACK);
  }
  if (url.pathname !== CHATGPT_CALLBACK_PATH) {
    return Promise.resolve(NOT_A_CALLBACK);
  }
  return finishLogin(url.searchParams);
}
