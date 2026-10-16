export const PREVIEW_BLOCKS_TOOL_NAME = "PreviewBlocks";
export const PREVIEW_BLOCKS_TOOL_DESCRIPTION =
  "Shows the user a live preview of DMS blocks as an attachment in the chat: a card they open to see the real blocks rendered, next to their own mockup when you pass it as `reference`, with one tab per variant. A view may carry a `sketch` instead of (or beside) its `tree`: static HTML and CSS of a custom component you propose, drawn in a sandbox and labelled as not a DMS block, so the user compares it with the DMS option before any code is written. Use it to settle a visual choice before building (DMS block as is versus custom, or between layouts), then ask the decision with AskUser. It returns at once with the preview id; it does not wait for the user and changes nothing in the project.";

/** Bounds of one preview, so a runaway tree cannot flood the transcript. */
export const PREVIEW_MAX_DEPTH = 8;
export const PREVIEW_MAX_NODES = 200;
export const PREVIEW_MAX_VARIANTS = 4;
export const PREVIEW_MAX_ROOTS = 12;
export const PREVIEW_MAX_TITLE_CHARS = 120;
export const PREVIEW_MAX_LABEL_CHARS = 60;
export const PREVIEW_MAX_DESCRIPTION_CHARS = 2_000;
export const PREVIEW_MAX_CAPTION_CHARS = 200;
export const PREVIEW_MAX_URL_CHARS = 2_048;
export const PREVIEW_MAX_JSON_BYTES = 64 * 1024;
export const PREVIEW_SKETCH_MIN_HEIGHT_PX = 80;
export const PREVIEW_SKETCH_DEFAULT_HEIGHT_PX = 320;
export const PREVIEW_SKETCH_MAX_HEIGHT_PX = 1_200;

/** `reference.attachmentId` value naming the image the user attached last. */
export const PREVIEW_LATEST_ATTACHMENT_ID = "latest";

/** Only a same-origin path is loaded; anything else is shown as a link. */
export const PREVIEW_SAME_ORIGIN_PATH = /^\/(?![/\\])/;
export const PREVIEW_REMOTE_URL = /^https?:\/\//i;

export const PREVIEW_IMAGE_MIME_PREFIX = "image/";

/** Option keys the DMS loads from: they must name a path of the site. */
export const PREVIEW_URL_OPTION_KEY = /(?:Url|^location)$/;

export const PREVIEW_ERROR_CODES = {
  INVALID_TREE: "invalid_tree",
  TOO_LARGE: "too_large",
  UNKNOWN_ATTACHMENT: "unknown_attachment",
  INVALID_URL: "invalid_url",
  INVALID_SKETCH: "invalid_sketch",
} as const;

/**
 * Markup a sketch may not hold. The chat draws sketches in a sandboxed frame
 * with no scripts and a CSP that loads nothing but `data:` images and fonts;
 * these checks only turn a sketch that would break there into a clear error.
 */
export const PREVIEW_SKETCH_FORBIDDEN: ReadonlyArray<
  readonly [RegExp, string]
> = [
  [/<\s*script\b/i, "a <script> element"],
  [
    /<\s*(?:iframe|frame|frameset|object|embed|applet|portal|link|base)\b/i,
    "an embedding or linking element (iframe, object, embed, link, base)",
  ],
  [/<\s*meta\b[^>]*http-equiv/i, "a <meta http-equiv>"],
  [/<[^>]*[\s/"']on[a-z]+\s*=/i, "an on* event handler attribute"],
  [/(?:java|vb)script\s*:/i, "a javascript: URL"],
  [/@import\b/i, "a CSS @import"],
  [/url\(\s*(?!['"]?\s*data:)/i, "a url() that is not a data: URL"],
  [
    /<[^>]*\s(?:src|srcset|href|xlink:href|poster|action|formaction|background|data|ping)\s*=\s*(?!['"]?\s*(?:data:|#))/i,
    "a src, href or similar attribute that is not a data: URL or an #anchor",
  ],
];

export const PREVIEW_RESULT_SHOWN =
  "Preview shown to the user as an attachment. If it settles a choice, ask it now with AskUser.";
export const PREVIEW_ERROR_NO_TYPE =
  "Every node needs a `type` (a block type from BuilderCatalog) or a `componentName`.";
export const PREVIEW_ERROR_DEPTH = `The tree is nested deeper than ${PREVIEW_MAX_DEPTH} levels.`;
export const PREVIEW_ERROR_NODES = `The preview has more than ${PREVIEW_MAX_NODES} nodes in all; show a smaller part of the page.`;
export const PREVIEW_ERROR_BYTES = `The preview's trees and sketches are larger than ${PREVIEW_MAX_JSON_BYTES} bytes of JSON; show a smaller part of the page.`;
export const PREVIEW_ERROR_NO_ATTACHMENTS =
  "The user attached no image in this conversation; leave `reference.attachmentId` out.";
export const PREVIEW_ERROR_UNKNOWN_ATTACHMENT =
  "No image of that name was attached in this conversation. Attached images: ";
export const PREVIEW_ERROR_OPTION_URL =
  "Options ending in `Url` (and `location`) must be same-origin paths such as `/api/orders`, or the preview refuses the block. Offending option: ";
export const PREVIEW_ERROR_EMPTY_VIEW =
  "Every view (the preview and each variant) needs a `tree`, a `sketch`, or both.";
export const PREVIEW_ERROR_SKETCH =
  "A sketch is static HTML and CSS: inline images and fonts as data: URLs, and use no script, event handler, external resource or embedded frame. Refused: ";
export const PREVIEW_ERROR_URL =
  "`reference.url` must be a same-origin path (`/media/...`) or an http(s) URL.";
