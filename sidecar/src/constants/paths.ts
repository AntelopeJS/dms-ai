import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const CHATBOX_DIST_DIR = resolve(here, "../../chatbox/dist");
export const SIDECAR_PACKAGE_JSON = resolve(here, "../../package.json");
export const STATE_DIR_SEGMENTS = ["node_modules", ".cache", "dms-ai"] as const;

// A client-chosen identifier becomes a directory name through safeDirSegment:
// everything outside this class is replaced, the label is capped so the whole
// path stays under the Windows MAX_PATH budget, and a short digest of the raw
// id keeps two ids that reduce to the same label apart.
export const SEGMENT_UNSAFE_CHARS = /[^\w-]+/g;
export const SEGMENT_LABEL_MAX_LENGTH = 48;
export const SEGMENT_FALLBACK_LABEL = "conversation";
export const SEGMENT_HASH_ALGORITHM = "sha256";
export const SEGMENT_HASH_LENGTH = 8;
