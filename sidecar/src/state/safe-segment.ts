import { createHash } from "node:crypto";
import {
  SEGMENT_FALLBACK_LABEL,
  SEGMENT_HASH_ALGORITHM,
  SEGMENT_HASH_LENGTH,
  SEGMENT_LABEL_MAX_LENGTH,
  SEGMENT_UNSAFE_CHARS,
} from "../constants/paths.js";

function label(raw: string): string {
  const safe = raw.replace(SEGMENT_UNSAFE_CHARS, "_");
  const trimmed = safe.slice(0, SEGMENT_LABEL_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : SEGMENT_FALLBACK_LABEL;
}

function fingerprint(raw: string): string {
  return createHash(SEGMENT_HASH_ALGORITHM)
    .update(raw)
    .digest("hex")
    .slice(0, SEGMENT_HASH_LENGTH);
}

/**
 * One directory name for an identifier the client chose, on any platform.
 *
 * Identifiers reach the sidecar as free-form strings over the websocket, and
 * they end up naming directories that are created, written to and removed
 * recursively. Reducing them to a single safe segment is what keeps a crafted
 * id (`../../etc`, `C:\\`, a trailing dot Windows silently strips) inside the
 * tree it belongs to; the fingerprint is what keeps two ids that reduce to the
 * same label from sharing — and deleting — each other's directory.
 */
export function safeDirSegment(raw: string): string {
  return `${label(raw)}-${fingerprint(raw)}`;
}
