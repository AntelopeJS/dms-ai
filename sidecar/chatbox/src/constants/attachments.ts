// Client-side mirror of the sidecar attachment limits (see
// sidecar/src/constants/attachments.ts). Kept in sync manually, like the WS
// message-type constants.

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

// Media types shown with an image thumbnail (and inlined natively by the agent).
export const INLINE_IMAGE_MIME_TYPES = [
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
] as const;

// Phosphor icons (already bundled via @iconify-json/ph).
export const ATTACH_ICON = "i-ph-paperclip";
export const ATTACH_REMOVE_ICON = "i-ph-x";
export const ATTACH_FILE_ICON = "i-ph-file";

export const ATTACH_LABEL = "Attach files";
