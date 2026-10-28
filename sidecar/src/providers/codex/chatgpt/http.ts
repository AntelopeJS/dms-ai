import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CHATGPT_ACCESS_TOKEN_PATH,
  CHATGPT_CALLBACK_PATH,
} from "../../../constants/chatgpt.js";
import { CONTENT_TYPE, HTTP_STATUS } from "../../../constants/http.js";
import { sendResponse } from "../../../server/http-io.js";
import { getAccessToken } from "./credentials.js";
import { finishLogin, type LoginResponse } from "./login.js";
import { randomUrlSafe } from "./oauth.js";

const BEARER_PREFIX = "Bearer ";

/**
 * Shared with the app-servers this sidecar spawns, through their environment:
 * it is what lets their auth command read the access token, and nothing else.
 * Per process, so a token route outlives no sidecar.
 */
export const ACCESS_TOKEN_SECRET = randomUrlSafe();

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderPage(title: string, message: string): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#18181b}h1{font-size:1.25rem}p{line-height:1.5;color:#52525b}</style>",
    `</head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`,
  ].join("");
}

function sendLoginPage(res: ServerResponse, response: LoginResponse): void {
  sendResponse(
    res,
    response.status,
    CONTENT_TYPE.HTML,
    renderPage(response.title, response.message),
  );
}

function hasTokenSecret(req: IncomingMessage): boolean {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith(BEARER_PREFIX)) return false;
  const actual = Buffer.from(authorization.slice(BEARER_PREFIX.length));
  const expected = Buffer.from(ACCESS_TOKEN_SECRET);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Plain text both ways: the auth command prints the body as the bearer token,
 * or as the reason the request failed, which Codex then reports in the turn.
 */
async function sendAccessToken(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!hasTokenSecret(req)) {
    sendResponse(res, HTTP_STATUS.UNAUTHORIZED, CONTENT_TYPE.TEXT, "");
    return;
  }
  try {
    const token = await getAccessToken();
    sendResponse(res, HTTP_STATUS.OK, CONTENT_TYPE.TEXT, token);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    sendResponse(res, HTTP_STATUS.UNAVAILABLE, CONTENT_TYPE.TEXT, reason);
  }
}

/**
 * Serves the routes that cannot carry the backend's client credential: the
 * browser's return from OpenAI, and the app-servers' token reads. Resolves
 * whether it answered the request.
 */
export async function handleChatGptRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (req.method !== "GET") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  const routes: Record<string, () => Promise<void>> = {
    [CHATGPT_CALLBACK_PATH]: async () =>
      sendLoginPage(res, await finishLogin(url.searchParams)),
    [CHATGPT_ACCESS_TOKEN_PATH]: () => sendAccessToken(req, res),
  };
  const route = routes[url.pathname];
  if (route === undefined) return false;
  await route();
  return true;
}
