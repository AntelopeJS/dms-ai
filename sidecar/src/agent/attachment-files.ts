import fs from "node:fs/promises";
import path from "node:path";
import { UPLOADS_DIR_SEGMENT } from "../constants/attachments.js";
import { STATE_DIR_SEGMENTS } from "../constants/paths.js";
import type { AttachmentType } from "../protocol/messages.js";

const FALLBACK_FILE_NAME = "file";
const FALLBACK_SEGMENT = "conversation";

// Reduce an arbitrary upload name to a safe basename (strip directory parts and
// characters that could escape or confuse the uploads dir). Empty → "file".
export function sanitizeFileName(name: string): string {
  const base = path
    .basename(name)
    .replace(/[^\w.\- ]+/g, "_")
    .trim();
  return base.length > 0 ? base : FALLBACK_FILE_NAME;
}

// The conversationId arrives from the WS client as a free-form string; reduce
// it to a single safe path segment so a crafted id (e.g. "../../tmp") cannot
// escape the uploads tree.
export function sanitizePathSegment(segment: string): string {
  const safe = segment.replace(/[^\w-]+/g, "_");
  return safe.length > 0 ? safe : FALLBACK_SEGMENT;
}

export function uploadsDirFor(
  hostProjectRoot: string,
  conversationId: string,
): string {
  return path.join(
    hostProjectRoot,
    ...STATE_DIR_SEGMENTS,
    UPLOADS_DIR_SEGMENT,
    sanitizePathSegment(conversationId),
  );
}

// Write one attachment to the uploads dir and return its absolute path. The
// index disambiguates files that share a name within one message.
export async function writeDiskAttachment(
  att: AttachmentType,
  index: number,
  dir: string,
): Promise<string> {
  const fileName = `${Date.now()}-${index}-${sanitizeFileName(att.name)}`;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, Buffer.from(att.data, "base64"));
  return filePath;
}

export function joinTextSections(text: string, diskPaths: string[]): string {
  const noteLines = diskPaths.map((p) => `[Attached file: ${p}]`);
  const notes = noteLines.join("\n");
  const sections = [text.trim(), notes].filter((s) => s.length > 0);
  return sections.join("\n\n");
}
