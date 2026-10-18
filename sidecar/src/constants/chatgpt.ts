import { CODEX_CLIENT_NAME } from "./codex.js";

// Sign in with ChatGPT: the user's ChatGPT plan pays for Codex, through an
// OAuth client the sidecar registers for itself on first sign-in. Endpoints
// and parameters follow https://developers.openai.com/siwc/token-sharing-open-source.
export const CHATGPT_ISSUER = "https://auth.openai.com";
export const CHATGPT_AUTHORIZE_URL = `${CHATGPT_ISSUER}/api/accounts/authorize`;
export const CHATGPT_TOKEN_URL = `${CHATGPT_ISSUER}/api/accounts/oauth/token`;
export const CHATGPT_REVOKE_URL = `${CHATGPT_ISSUER}/api/accounts/oauth/revoke`;
export const CHATGPT_JWKS_URL = `${CHATGPT_ISSUER}/.well-known/jwks.json`;
export const CHATGPT_RESOURCE = "https://api.openai.com/v1";

// Sent as client_id until OpenAI issues one: the first sign-in registers the
// sidecar as a "user-defined agent" bound to the user and their workspace.
export const CHATGPT_DYNAMIC_CLIENT_ID = "dynamic_agent_client";
// Must match the app-server's clientInfo.name, which attributes requests.
export const CHATGPT_AGENT_NAME_HINT = CODEX_CLIENT_NAME;
export const CHATGPT_PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const CHATGPT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  CHATGPT_PLAN_SCOPE,
].join(" ");

// The redirect has to be an HTTP loopback URI on 127.0.0.1 (never
// `localhost`) whose only varying part is the port: the sidecar's own server.
export const CHATGPT_LOGIN_START_PATH = "/auth/chatgpt/start";
export const CHATGPT_CALLBACK_PATH = "/auth/chatgpt/callback";
export const CHATGPT_LOGIN_TICKET_PARAM = "ticket";

// Long enough to read the consent screen and pick an account, short enough
// that a stale link or a half-finished attempt does not linger.
export const CHATGPT_LOGIN_TTL_MS = 10 * 60_000;
export const CHATGPT_RANDOM_BYTES = 32;

// Refreshed this long before expiry: an access token lasts an hour, and Codex
// holds the one it was given for up to CODEX_AUTH_REFRESH_INTERVAL_MS.
export const CHATGPT_REFRESH_MARGIN_MS = 15 * 60_000;
export const CHATGPT_HTTP_TIMEOUT_MS = 15_000;
// Clock skew tolerated on the ID token's `exp`.
export const CHATGPT_ID_TOKEN_LEEWAY_S = 60;

// Errors after which the stored tokens can never work again: they are cleared
// and the user signs in anew. Anything else (network, 5xx) keeps them.
export const CHATGPT_TERMINAL_REFRESH_ERRORS: readonly string[] = [
  "invalid_grant",
  "token_expired",
  "refresh_token_expired",
  "invalid_refresh_token",
  "refresh_token_invalidated",
  "refresh_token_reused",
];

// Per user, not per project: one sign-in serves every DMS project on the
// machine, and a 30-day refresh token stays out of the project tree (and out
// of anything it gets copied into).
export const CHATGPT_CONFIG_DIR_NAME = "dms-ai";
export const CHATGPT_AUTH_FILE_NAME = "chatgpt-auth.json";
export const CHATGPT_AUTH_FILE_MODE = 0o600;
export const CHATGPT_CONFIG_DIR_MODE = 0o700;
export const XDG_CONFIG_HOME_ENV = "XDG_CONFIG_HOME";
export const APPDATA_ENV = "APPDATA";
export const POSIX_CONFIG_DIR = ".config";

// Serializes refreshes across sidecars of different projects: the refresh
// token rotates, so two concurrent refreshes would invalidate each other.
export const CHATGPT_LOCK_DIR_NAME = "chatgpt-auth.lock";
export const CHATGPT_LOCK_STALE_MS = 60_000;
export const CHATGPT_LOCK_POLL_MS = 100;
export const CHATGPT_LOCK_TIMEOUT_MS = 30_000;

// Codex asks the sidecar for the current access token through this route; the
// secret travels in the app-server's environment, never on disk.
export const CHATGPT_ACCESS_TOKEN_PATH = "/codex/access-token";
export const CHATGPT_TOKEN_URL_ENV = "DMS_AI_CHATGPT_TOKEN_URL";
export const CHATGPT_TOKEN_SECRET_ENV = "DMS_AI_CHATGPT_TOKEN_SECRET";
// How long Codex reuses a token before asking again. It also asks again after
// a 401, so this only bounds how stale a token it holds can be.
export const CODEX_AUTH_REFRESH_INTERVAL_MS = 5 * 60_000;
export const CODEX_AUTH_COMMAND_TIMEOUT_MS = 30_000;

export const CHATGPT_LOG_PREFIX = "[dms-ai chatgpt]";
export const CHATGPT_NOT_SIGNED_IN_MESSAGE =
  "[dms-ai] Codex needs a ChatGPT account: sign in from Assistant › Settings.";
export const CHATGPT_SIGNED_OUT_MESSAGE =
  "[dms-ai] the ChatGPT sign-in expired or was revoked: sign in again from Assistant › Settings.";
export const OPENAI_API_KEY_IGNORED_WARNING =
  "OPENAI_API_KEY is ignored: Codex now runs on your ChatGPT plan. Sign in with ChatGPT from Assistant › Settings.";
export const OPENAI_API_KEY_ENV_VAR = "OPENAI_API_KEY";
