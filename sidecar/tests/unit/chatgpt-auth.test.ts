import {
  generateKeyPairSync,
  type JsonWebKey,
  type KeyObject,
  sign,
} from "node:crypto";
import { statSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHATGPT_JWKS_URL,
  CHATGPT_NOT_SIGNED_IN_MESSAGE,
  CHATGPT_SIGNED_OUT_MESSAGE,
  CHATGPT_TOKEN_URL,
} from "../../src/constants/chatgpt.js";
import {
  getAccessToken,
  readAccountStatus,
} from "../../src/providers/codex/chatgpt/credentials.js";
import {
  createLoginUrl,
  finishLogin,
  finishPastedLogin,
} from "../../src/providers/codex/chatgpt/login.js";
import { pkceChallenge } from "../../src/providers/codex/chatgpt/oauth.js";
import {
  chatGptAuthFile,
  readAuthRecord,
  writeAuthRecord,
} from "../../src/providers/codex/chatgpt/store.js";
import {
  signedInRecord,
  useTemporaryConfigHome,
} from "../helpers/chatgpt-auth.js";

const MINUTE_MS = 60_000;
const PORT = 4321;
const ISSUED_CLIENT_ID = "oaiapp_issued";
const KEY_ID = "test-key";

function isText(body: RequestInit["body"]): body is string {
  return typeof body === "string";
}

interface FormCall {
  url: string;
  form: URLSearchParams;
}

/** Records every form POST, and answers each with what `answer` returns. */
function stubFetch(answer: (call: FormCall) => Response, jwks?: Jwks) {
  const calls: FormCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === CHATGPT_JWKS_URL) return Response.json(jwks ?? { keys: [] });
    const call = {
      url,
      form: new URLSearchParams(isText(init?.body) ? init.body : ""),
    };
    calls.push(call);
    return answer(call);
  });
  return calls;
}

function tokenAnswer(
  suffix: string,
  scope = "openid chatgpt.tokens.use.direct",
) {
  return Response.json({
    access_token: `access-${suffix}`,
    refresh_token: `refresh-${suffix}`,
    id_token: `id-${suffix}`,
    expires_in: 3600,
    scope,
  });
}

async function writeExpiringRecord(): Promise<void> {
  const record = signedInRecord();
  if (record.tokens === undefined) throw new Error("fixture has no tokens");
  await writeAuthRecord({
    ...record,
    tokens: { ...record.tokens, expiresAt: Date.now() + 5 * MINUTE_MS },
  });
}

let restoreHome: () => void;

beforeEach(() => {
  restoreHome = useTemporaryConfigHome();
});

afterEach(() => {
  vi.unstubAllGlobals();
  restoreHome();
});

describe("access token", () => {
  it("refuses before any sign-in", async () => {
    await expect(getAccessToken()).rejects.toThrow(
      CHATGPT_NOT_SIGNED_IN_MESSAGE,
    );
  });

  it("serves a fresh token without asking OpenAI", async () => {
    await writeAuthRecord(signedInRecord());
    const calls = stubFetch(() => tokenAnswer("never"));
    await expect(getAccessToken()).resolves.toBe("chatgpt-access-mock");
    expect(calls).toEqual([]);
  });

  it("refreshes one about to expire, and keeps the rotated refresh token", async () => {
    await writeExpiringRecord();
    const calls = stubFetch(() => tokenAnswer("new"));
    await expect(getAccessToken()).resolves.toBe("access-new");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(CHATGPT_TOKEN_URL);
    expect(Object.fromEntries(calls[0]?.form ?? [])).toEqual({
      grant_type: "refresh_token",
      client_id: "oaiapp_test",
      refresh_token: "chatgpt-refresh-mock",
      resource: "https://api.openai.com/v1",
    });
    expect(readAuthRecord()?.tokens?.refreshToken).toBe("refresh-new");
  });

  it("spends the refresh token once for concurrent readers", async () => {
    await writeExpiringRecord();
    const calls = stubFetch(() => tokenAnswer("once"));
    const tokens = await Promise.all([
      getAccessToken(),
      getAccessToken(),
      getAccessToken(),
    ]);
    expect(tokens).toEqual(["access-once", "access-once", "access-once"]);
    expect(calls).toHaveLength(1);
  });

  it("forgets a sign-in OpenAI no longer accepts, and says so", async () => {
    await writeExpiringRecord();
    stubFetch(() =>
      Response.json({ error: "refresh_token_reused" }, { status: 400 }),
    );
    await expect(getAccessToken()).rejects.toThrow(CHATGPT_SIGNED_OUT_MESSAGE);
    expect(readAccountStatus()).toEqual({ isSignedIn: false });
    expect(readAuthRecord()?.clientId).toBe("oaiapp_test");
  });

  it("keeps the sign-in through a temporary failure", async () => {
    await writeExpiringRecord();
    stubFetch(() => new Response("upstream down", { status: 503 }));
    await expect(getAccessToken()).rejects.toThrow("http_503");
    expect(readAccountStatus().isSignedIn).toBe(true);
  });

  it("stores the tokens readable by their owner only", async () => {
    await writeAuthRecord(signedInRecord());
    expect(statSync(chatGptAuthFile()).mode & 0o777).toBe(0o600);
  });
});

interface SigningKey {
  privateKey: KeyObject;
  jwks: Jwks;
}

function createSigningKey(): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" });
  return {
    privateKey,
    jwks: { keys: [{ ...jwk, kid: KEY_ID, alg: "RS256" }] },
  };
}

interface Jwks {
  keys: JsonWebKey[];
}

interface IdTokenClaims {
  iss: string;
  aud: string;
  exp: number;
  nonce: string;
  sub: string;
  email?: string;
}

interface JwtHeader {
  alg: string;
  kid: string;
}

function signIdToken(key: KeyObject, claims: IdTokenClaims): string {
  const encode = (value: IdTokenClaims | JwtHeader) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = `${encode({ alg: "RS256", kid: KEY_ID })}.${encode(claims)}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), key).toString(
    "base64url",
  );
  return `${signingInput}.${signature}`;
}

interface StartedLogin {
  state: string;
  nonce: string;
  authorize: URL;
}

async function startFromSettings(): Promise<StartedLogin> {
  const authorize = new URL(await createLoginUrl(PORT));
  return {
    authorize,
    state: authorize.searchParams.get("state") ?? "",
    nonce: authorize.searchParams.get("nonce") ?? "",
  };
}

describe("sign-in", () => {
  it("registers the host on first sign-in, with PKCE and a loopback redirect", async () => {
    const { authorize } = await startFromSettings();
    const query = authorize.searchParams;
    expect(query.get("client_id")).toBe("dynamic_agent_client");
    expect(query.get("agent_name_hint")).toBe("antelopejs_dms_ai");
    expect(query.get("ext_agent_host_id")).toBe(readAuthRecord()?.hostId);
    expect(query.get("redirect_uri")).toBe(
      `http://127.0.0.1:${PORT}/auth/chatgpt/callback`,
    );
    expect(query.get("scope")?.split(" ")).toContain(
      "chatgpt.tokens.use.direct",
    );
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.get("code_challenge")).toMatch(/^[\w-]{43}$/);
  });

  it("stores the account once the pasted code, the ID token and the plan scope check out", async () => {
    const key = createSigningKey();
    const { state, nonce, authorize } = await startFromSettings();
    const idToken = signIdToken(key.privateKey, {
      iss: "https://auth.openai.com",
      aud: ISSUED_CLIENT_ID,
      exp: Date.now() / 1000 + 3600,
      nonce,
      sub: "user-42",
      email: "dev@example.com",
    });
    const calls = stubFetch(
      () =>
        Response.json({
          access_token: "access-first",
          refresh_token: "refresh-first",
          id_token: idToken,
          expires_in: 3600,
          scope: "openid email chatgpt.tokens.use.direct",
        }),
      key.jwks,
    );
    const pasted = new URL(`http://127.0.0.1:${PORT}/auth/chatgpt/callback`);
    pasted.search = new URLSearchParams({
      code: "the-code",
      state,
      client_id: ISSUED_CLIENT_ID,
    }).toString();
    const response = await finishPastedLogin(` ${pasted.toString()} `);
    expect(response).toMatchObject({ status: 200 });
    const exchange = calls[0]?.form;
    expect(exchange?.get("grant_type")).toBe("authorization_code");
    expect(exchange?.get("client_id")).toBe(ISSUED_CLIENT_ID);
    expect(pkceChallenge(exchange?.get("code_verifier") ?? "")).toBe(
      authorize.searchParams.get("code_challenge"),
    );
    expect(readAccountStatus()).toEqual({
      isSignedIn: true,
      email: "dev@example.com",
    });
    expect(readAuthRecord()).toMatchObject({
      clientId: ISSUED_CLIENT_ID,
      subject: "user-42",
    });
  });

  it("rejects an ID token issued for another sign-in attempt", async () => {
    const key = createSigningKey();
    const { state } = await startFromSettings();
    const idToken = signIdToken(key.privateKey, {
      iss: "https://auth.openai.com",
      aud: ISSUED_CLIENT_ID,
      exp: Date.now() / 1000 + 3600,
      nonce: "replayed-nonce",
      sub: "user-42",
    });
    stubFetch(
      () =>
        Response.json({
          access_token: "a",
          refresh_token: "r",
          id_token: idToken,
          expires_in: 3600,
          scope: "chatgpt.tokens.use.direct",
        }),
      key.jwks,
    );
    const response = await finishLogin(
      new URLSearchParams({ state, code: "c", client_id: ISSUED_CLIENT_ID }),
    );
    expect(response).toMatchObject({ status: 502 });
    expect(readAccountStatus().isSignedIn).toBe(false);
  });

  it("does not store a sign-in that did not grant plan usage", async () => {
    const { state } = await startFromSettings();
    stubFetch(() => tokenAnswer("noplan", "openid email"));
    const response = await finishLogin(
      new URLSearchParams({ state, code: "c", client_id: ISSUED_CLIENT_ID }),
    );
    expect(response).toMatchObject({ status: 403 });
    expect(readAccountStatus().isSignedIn).toBe(false);
  });

  it("treats a registration answered without an issued client id as incomplete", async () => {
    const { state } = await startFromSettings();
    const calls = stubFetch(() => tokenAnswer("never"));
    const response = await finishLogin(
      new URLSearchParams({ state, code: "c" }),
    );
    expect(response).toMatchObject({ status: 400 });
    expect(calls).toEqual([]);
  });

  it("answers a replayed callback as expired", async () => {
    const { state } = await startFromSettings();
    stubFetch(() => tokenAnswer("x"));
    await finishLogin(new URLSearchParams({ state, error: "access_denied" }));
    const replay = await finishLogin(new URLSearchParams({ state, code: "c" }));
    expect(replay).toMatchObject({
      status: 400,
      title: "This sign-in link has expired",
    });
  });

  it("refuses a pasted address that is not the return address, keeping the attempt open", async () => {
    const { state } = await startFromSettings();
    const calls = stubFetch(() => tokenAnswer("never"));
    const wrong = await finishPastedLogin(
      `https://chatgpt.com/?code=c&state=${state}`,
    );
    expect(wrong).toMatchObject({
      status: 400,
      title: "Not the sign-in address",
    });
    expect(await finishPastedLogin("not a url")).toMatchObject({ status: 400 });
    expect(calls).toEqual([]);
    /** The real address still completes it. */
    const cancelled = await finishPastedLogin(
      `http://127.0.0.1:${PORT}/auth/chatgpt/callback?error=access_denied&state=${state}`,
    );
    expect(cancelled.title).toBe("Sign-in cancelled");
  });

  it("derives the PKCE challenge as base64url SHA-256 without padding", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});
