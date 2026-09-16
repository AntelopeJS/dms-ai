export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  SERVER_ERROR: 500,
} as const;

export const CONTENT_TYPE = {
  JSON: "application/json; charset=utf-8",
  TEXT: "text/plain; charset=utf-8",
  HTML: "text/html; charset=utf-8",
  CSS: "text/css; charset=utf-8",
  JS: "application/javascript; charset=utf-8",
  SVG: "image/svg+xml",
  PNG: "image/png",
  ICO: "image/x-icon",
  WOFF2: "font/woff2",
  OCTET: "application/octet-stream",
} as const;

export const MIME_BY_EXT: Record<string, string> = {
  ".html": CONTENT_TYPE.HTML,
  ".js": CONTENT_TYPE.JS,
  ".mjs": CONTENT_TYPE.JS,
  ".css": CONTENT_TYPE.CSS,
  ".json": CONTENT_TYPE.JSON,
  ".svg": CONTENT_TYPE.SVG,
  ".png": CONTENT_TYPE.PNG,
  ".ico": CONTENT_TYPE.ICO,
  ".woff2": CONTENT_TYPE.WOFF2,
};
