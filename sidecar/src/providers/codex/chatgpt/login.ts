import {
  CHATGPT_CALLBACK_PATH,
  CHATGPT_DYNAMIC_CLIENT_ID,
  CHATGPT_LOG_PREFIX,
  CHATGPT_LOGIN_START_PATH,
  CHATGPT_LOGIN_TICKET_PARAM,
  CHATGPT_LOGIN_TTL_MS,
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

/** What the loopback routes answer: a redirect, or a page for the user. */
export type LoginResponse =
  | { kind: "redirect"; location: string }
  | { kind: "page"; status: number; title: string; message: string };

// A ticket makes the start link unguessable: without it, any page the user
// visits could send their browser to the sidecar and open a consent screen.
const tickets = new Map<string, number>();
const attempts = new Map<string, PendingAttempt>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [ticket, expiresAt] of tickets) {
    if (expiresAt <= now) tickets.delete(ticket);
  }
  for (const [state, attempt] of attempts) {
    if (attempt.expiresAt <= now) attempts.delete(state);
  }
}

function loopbackUrl(port: number, pathname: string): URL {
  return new URL(`http://${LOOPBACK_HOST}:${port}${pathname}`);
}

/**
 * The link the Settings page offers to sign in: the sidecar's own loopback
 * server, which then sends the browser to OpenAI. It only works from a browser
 * on the sidecar's machine, as OpenAI's loopback redirect requires.
 */
export function createLoginUrl(port: number): string {
  sweepExpired();
  const ticket = randomUrlSafe();
  tickets.set(ticket, Date.now() + CHATGPT_LOGIN_TTL_MS);
  const url = loopbackUrl(port, CHATGPT_LOGIN_START_PATH);
  url.searchParams.set(CHATGPT_LOGIN_TICKET_PARAM, ticket);
  return url.toString();
}

function page(status: number, title: string, message: string): LoginResponse {
  return { kind: "page", status, title, message };
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

/** GET /auth/chatgpt/start: opens an attempt and sends the browser to OpenAI. */
export async function startLogin(
  query: URLSearchParams,
  port: number,
): Promise<LoginResponse> {
  sweepExpired();
  const ticket = query.get(CHATGPT_LOGIN_TICKET_PARAM);
  if (ticket === null || !tickets.has(ticket)) return EXPIRED_LINK;
  const record = await withAuthLock(ensureRecord);
  const state = randomUrlSafe();
  const attempt: PendingAttempt = {
    clientId: record.clientId,
    hostId: record.hostId,
    redirectUri: loopbackUrl(port, CHATGPT_CALLBACK_PATH).toString(),
    nonce: randomUrlSafe(),
    codeVerifier: randomUrlSafe(),
    expiresAt: Date.now() + CHATGPT_LOGIN_TTL_MS,
  };
  attempts.set(state, attempt);
  const location = buildAuthorizeUrl({
    ...attempt,
    state,
    idTokenHint:
      record.clientId === undefined ? undefined : record.tokens?.idToken,
    loginHint: record.clientId === undefined ? undefined : record.email,
  });
  return { kind: "redirect", location };
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
