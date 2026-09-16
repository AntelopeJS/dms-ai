// Limits and classification for user-attached files (images/PDF inlined as
// content blocks, other files written to disk and referenced by path). Shared by
// the wire schema, the WS payload cap, and the turn-content builder.

// Max size of a single attachment, measured on the raw (pre-base64) bytes.
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

// Image media types Claude can perceive natively — inlined as `image` blocks.
// Anything else image-like (e.g. svg, bmp) falls through to the on-disk path.
export const INLINE_IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type InlineImageMediaType = (typeof INLINE_IMAGE_MEDIA_TYPES)[number];

// PDFs are inlined as `document` blocks (native perception).
export const PDF_MEDIA_TYPE = "application/pdf";

// Sub-directory (under the dms-ai state dir) where non-inline attachments are
// written so the agent can read them by path.
export const UPLOADS_DIR_SEGMENT = "uploads";

// Cap on a single WS frame. A full message carries every attachment base64-
// encoded (~1.34x the raw bytes), so the worst case is roughly
// MAX_ATTACHMENTS_PER_MESSAGE * MAX_ATTACHMENT_BYTES * 1.34; size the frame
// generously above that (ws defaults to 100 MiB, which would drop such frames).
export const WS_MAX_PAYLOAD_BYTES = 384 * 1024 * 1024;
