/**
 * Where the chat document and its assets are served. Under `/api/` because the
 * DMS frontend server takes any other `text/html` GET for a page visit.
 */
export const CHATBOX_ROUTE_PREFIX = "/api/ai/chatbox";
export const CHATBOX_INDEX_ROUTE = "/";
export const CHATBOX_ASSET_ROUTE = "::path";
export const CHATBOX_PATH_PARAM = "path";
export const CHATBOX_INDEX_PATH = "/";
export const CHATBOX_DEFAULT_CONTENT_TYPE = "application/octet-stream";

/** Headers of the sidecar's static response that travel on to the browser. */
export const CHATBOX_RELAYED_HEADERS = ["content-length"] as const;

/**
 * Where Nuxt UI fetches the chat's icons at runtime: the chatbox's @nuxt/ui
 * predates the client bundle the DMS renderer uses to ship them.
 */
const ICONIFY_API_ORIGINS = [
  "https://api.iconify.design",
  "https://api.simplesvg.com",
  "https://api.unisvg.com",
];

/**
 * Served same-origin with the dashboard, the chat renders model output: a
 * prompt injection carried by a file or a page must not reach the owner's
 * session. Scripts only from the bundle, and nothing loaded outside the origin,
 * which also closes the classic exfiltration through a remote Markdown image.
 * Inline styles stay allowed: CSS cannot run code, and every way it could leak
 * data out is closed by the other directives.
 */
export const CHATBOX_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${ICONIFY_API_ORIGINS.join(" ")}`,
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

export const CHATBOX_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": CHATBOX_CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Cache-Control": "no-cache",
};

export const CHATBOX_UNAVAILABLE_STATUS = 503;
