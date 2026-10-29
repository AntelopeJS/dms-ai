import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { z } from "zod";
import {
  CHATGPT_AGENT_NAME_HINT,
  CHATGPT_AUTHORIZE_URL,
  CHATGPT_DYNAMIC_CLIENT_ID,
  CHATGPT_HTTP_TIMEOUT_MS,
  CHATGPT_ID_TOKEN_LEEWAY_S,
  CHATGPT_ISSUER,
  CHATGPT_JWKS_URL,
  CHATGPT_RANDOM_BYTES,
  CHATGPT_RESOURCE,
  CHATGPT_REVOKE_URL,
  CHATGPT_SCOPES,
  CHATGPT_TERMINAL_REFRESH_ERRORS,
  CHATGPT_TOKEN_URL,
} from "../../../constants/chatgpt.js";
import type { ChatGptTokens } from "./store.js";

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const MS_PER_SECOND = 1000;
const ID_TOKEN_ALGORITHM = "RS256";
const RSA_SHA256 = "RSA-SHA256";

/** An answer of OpenAI's OAuth server other than success. */
export class ChatGptOAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    description?: string,
  ) {
    super(`${code}${description === undefined ? "" : `: ${description}`}`);
  }

  /** The stored tokens can never work again: the user has to sign in anew. */
  get isTerminal(): boolean {
    return CHATGPT_TERMINAL_REFRESH_ERRORS.includes(this.code);
  }
}

export function randomUrlSafe(): string {
  return randomBytes(CHATGPT_RANDOM_BYTES).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** What one authorization attempt sends, and has to find again on return. */
export interface AuthorizeParams {
  /** The issued client id, or undefined on the first sign-in of this host. */
  clientId?: string;
  hostId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  /** The account's previous ID token, to preselect it on reauthorization. */
  idTokenHint?: string;
  loginHint?: string;
}

/**
 * The OpenAI authorization URL. The agent name hint is display metadata for the
 * registration only; reauthorization omits it.
 */
export function buildAuthorizeUrl(params: AuthorizeParams): string {
  const url = new URL(CHATGPT_AUTHORIZE_URL);
  const query = url.searchParams;
  const isRegistration = params.clientId === undefined;
  query.set("client_id", params.clientId ?? CHATGPT_DYNAMIC_CLIENT_ID);
  if (isRegistration) query.set("agent_name_hint", CHATGPT_AGENT_NAME_HINT);
  query.set("ext_agent_host_id", params.hostId);
  query.set("response_type", "code");
  query.set("redirect_uri", params.redirectUri);
  query.set("scope", CHATGPT_SCOPES);
  query.set("resource", CHATGPT_RESOURCE);
  query.set("state", params.state);
  query.set("nonce", params.nonce);
  query.set("code_challenge", pkceChallenge(params.codeVerifier));
  query.set("code_challenge_method", "S256");
  if (params.idTokenHint !== undefined) {
    query.set("id_token_hint", params.idTokenHint);
  }
  if (params.loginHint !== undefined) query.set("login_hint", params.loginHint);
  return url.toString();
}

const optionalString = z.string().optional().catch(undefined);

const tokenResponseBodySchema = z.object({
  access_token: optionalString,
  refresh_token: optionalString,
  id_token: optionalString,
  expires_in: z.number().optional().catch(undefined),
  scope: optionalString,
  error: optionalString,
  error_description: optionalString,
});

type TokenResponseBody = z.infer<typeof tokenResponseBodySchema>;

async function postForm(
  url: string,
  fields: Record<string, string>,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": FORM_CONTENT_TYPE, Accept: "application/json" },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(CHATGPT_HTTP_TIMEOUT_MS),
  });
}

async function readJson(response: Response): Promise<TokenResponseBody> {
  try {
    return tokenResponseBodySchema.parse(await response.json());
  } catch {
    return {};
  }
}

/** The token set a successful answer carries; `previous` fills what it omits. */
function toTokens(
  body: TokenResponseBody,
  previous?: ChatGptTokens,
): ChatGptTokens {
  const accessToken = body.access_token;
  const refreshToken = body.refresh_token ?? previous?.refreshToken;
  const idToken = body.id_token ?? previous?.idToken;
  if (
    accessToken === undefined ||
    refreshToken === undefined ||
    idToken === undefined ||
    body.expires_in === undefined
  ) {
    throw new ChatGptOAuthError("invalid_token_response", 200);
  }
  return {
    accessToken,
    refreshToken,
    idToken,
    expiresAt: Date.now() + body.expires_in * MS_PER_SECOND,
    scopes: (body.scope ?? "").split(" ").filter((scope) => scope !== ""),
  };
}

async function requestTokens(
  fields: Record<string, string>,
  previous?: ChatGptTokens,
): Promise<ChatGptTokens> {
  const response = await postForm(CHATGPT_TOKEN_URL, fields);
  const body = await readJson(response);
  if (!response.ok) {
    throw new ChatGptOAuthError(
      body.error ?? `http_${response.status}`,
      response.status,
      body.error_description,
    );
  }
  return toTokens(body, previous);
}

export interface CodeExchange {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export function exchangeCode(exchange: CodeExchange): Promise<ChatGptTokens> {
  return requestTokens({
    grant_type: "authorization_code",
    client_id: exchange.clientId,
    code: exchange.code,
    code_verifier: exchange.codeVerifier,
    redirect_uri: exchange.redirectUri,
    resource: CHATGPT_RESOURCE,
  });
}

/**
 * Spends the refresh token for a new set. The refresh token rotates: the one
 * sent is dead once this resolves, so the caller must store the answer before
 * anyone else reads the record. `scope` is omitted, which keeps the grant.
 */
export function refreshTokens(
  clientId: string,
  previous: ChatGptTokens,
): Promise<ChatGptTokens> {
  return requestTokens(
    {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: previous.refreshToken,
      resource: CHATGPT_RESOURCE,
    },
    previous,
  );
}

/** Revokes the session; resolves whether OpenAI confirmed it. */
export async function revokeRefreshToken(
  clientId: string,
  refreshToken: string,
): Promise<boolean> {
  try {
    const response = await postForm(CHATGPT_REVOKE_URL, {
      token: refreshToken,
      token_type_hint: "refresh_token",
      client_id: clientId,
    });
    return response.ok;
  } catch {
    return false;
  }
}

const jwtHeaderSchema = z.object({
  alg: optionalString,
  kid: optionalString,
});

/** What a validated ID token says about the account. */
export interface IdTokenClaims {
  sub: string;
  email?: string;
}

const rawIdTokenClaimsSchema = z.object({
  iss: optionalString,
  aud: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .catch(undefined),
  exp: z.number().optional().catch(undefined),
  nonce: optionalString,
  sub: optionalString,
  email: optionalString,
});

const jwkSchema = z.looseObject({
  kid: optionalString,
  kty: optionalString,
  crv: optionalString,
  d: optionalString,
  dp: optionalString,
  dq: optionalString,
  e: optionalString,
  k: optionalString,
  n: optionalString,
  p: optionalString,
  q: optionalString,
  qi: optionalString,
  x: optionalString,
  y: optionalString,
});

type Jwk = z.infer<typeof jwkSchema>;

const jwksSchema = z.object({ keys: z.array(jwkSchema).optional() });

function decodeSegment<Schema extends z.ZodType>(
  segment: string | undefined,
  schema: Schema,
): z.output<Schema> {
  if (segment === undefined) throw new Error("malformed ID token");
  return schema.parse(
    JSON.parse(Buffer.from(segment, "base64url").toString("utf8")),
  );
}

async function fetchSigningKey(kid: string | undefined): Promise<Jwk> {
  const response = await fetch(CHATGPT_JWKS_URL, {
    signal: AbortSignal.timeout(CHATGPT_HTTP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`JWKS answered ${response.status}`);
  const jwks = jwksSchema.safeParse(await response.json());
  const key = jwks.data?.keys?.find((candidate) => candidate.kid === kid);
  if (key === undefined) throw new Error("ID token signed by an unknown key");
  return key;
}

function hasAudience(aud: string | string[] | undefined, clientId: string) {
  return Array.isArray(aud) ? aud.includes(clientId) : aud === clientId;
}

export interface IdTokenExpectations {
  clientId: string;
  nonce: string;
}

/**
 * Checks the ID token's signature against OpenAI's published keys, then its
 * issuer, audience, expiry and the nonce this attempt sent. Only then is its
 * `sub` trusted as the account's identity.
 */
export async function validateIdToken(
  idToken: string,
  expected: IdTokenExpectations,
): Promise<IdTokenClaims> {
  const [encodedHeader, encodedClaims, encodedSignature] = idToken.split(".");
  const header = decodeSegment(encodedHeader, jwtHeaderSchema);
  if (header.alg !== ID_TOKEN_ALGORITHM) {
    throw new Error(`ID token uses ${String(header.alg)}`);
  }
  const key = await fetchSigningKey(header.kid);
  const isSigned = verify(
    RSA_SHA256,
    Buffer.from(`${encodedHeader}.${encodedClaims}`),
    createPublicKey({ key, format: "jwk" }),
    Buffer.from(encodedSignature ?? "", "base64url"),
  );
  if (!isSigned) throw new Error("ID token signature does not verify");
  const claims = decodeSegment(encodedClaims, rawIdTokenClaimsSchema);
  const now = Date.now() / MS_PER_SECOND;
  if (claims.iss !== CHATGPT_ISSUER) throw new Error("ID token issuer");
  if (!hasAudience(claims.aud, expected.clientId)) {
    throw new Error("ID token audience");
  }
  if ((claims.exp ?? 0) + CHATGPT_ID_TOKEN_LEEWAY_S < now) {
    throw new Error("ID token expired");
  }
  if (claims.nonce !== expected.nonce) throw new Error("ID token nonce");
  if (claims.sub === undefined) throw new Error("ID token has no subject");
  return { sub: claims.sub, email: claims.email };
}
