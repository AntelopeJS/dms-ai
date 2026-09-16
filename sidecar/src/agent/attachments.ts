import fs from "node:fs/promises";
import path from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  INLINE_IMAGE_MEDIA_TYPES,
  type InlineImageMediaType,
  PDF_MEDIA_TYPE,
  UPLOADS_DIR_SEGMENT,
} from "../constants/attachments.js";
import { STATE_DIR_SEGMENTS } from "../constants/paths.js";
import type { AttachmentType } from "../protocol/messages.js";

// The content shape the SDK accepts for a user turn: either a bare string
// (the pre-attachment path) or an array of Anthropic content blocks.
export type TurnContent = SDKUserMessage["message"]["content"];
type ContentBlock = Exclude<TurnContent, string>[number];

export interface BuildTurnContentOptions {
  hostProjectRoot: string;
  conversationId: string;
}

function isInlineImage(mimeType: string): mimeType is InlineImageMediaType {
  return (INLINE_IMAGE_MEDIA_TYPES as readonly string[]).includes(mimeType);
}

function isInlinePdf(mimeType: string): boolean {
  return mimeType === PDF_MEDIA_TYPE;
}

function buildImageBlock(att: AttachmentType): ContentBlock {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: att.mimeType as InlineImageMediaType,
      data: att.data,
    },
  };
}

function buildDocumentBlock(att: AttachmentType): ContentBlock {
  return {
    type: "document",
    source: { type: "base64", media_type: PDF_MEDIA_TYPE, data: att.data },
    title: att.name,
  };
}

// Reduce an arbitrary upload name to a safe basename (strip directory parts and
// characters that could escape or confuse the uploads dir). Empty → "file".
function sanitizeFileName(name: string): string {
  const base = path
    .basename(name)
    .replace(/[^\w.\- ]+/g, "_")
    .trim();
  return base.length > 0 ? base : "file";
}

// The conversationId arrives from the WS client as a free-form string; reduce
// it to a single safe path segment so a crafted id (e.g. "../../tmp") cannot
// escape the uploads tree.
function sanitizePathSegment(segment: string): string {
  const safe = segment.replace(/[^\w-]+/g, "_");
  return safe.length > 0 ? safe : "conversation";
}

function uploadsDirFor(opts: BuildTurnContentOptions): string {
  return path.join(
    opts.hostProjectRoot,
    ...STATE_DIR_SEGMENTS,
    UPLOADS_DIR_SEGMENT,
    sanitizePathSegment(opts.conversationId),
  );
}

// Write one non-inline attachment to the uploads dir and return its absolute
// path. The index disambiguates files that share a name within one message.
async function writeDiskAttachment(
  att: AttachmentType,
  index: number,
  dir: string,
): Promise<string> {
  const fileName = `${Date.now()}-${index}-${sanitizeFileName(att.name)}`;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, Buffer.from(att.data, "base64"));
  return filePath;
}

function joinTextSections(text: string, diskPaths: string[]): string {
  const noteLines = diskPaths.map((p) => `[Attached file: ${p}]`);
  const notes = noteLines.join("\n");
  const sections = [text.trim(), notes].filter((s) => s.length > 0);
  return sections.join("\n\n");
}

// Turn the user's text plus their attachments into the SDK turn content:
// images/PDFs become inline base64 blocks (native perception); every other
// file is written to disk and referenced by absolute path in the text. When
// there are no attachments the original string is passed through untouched.
export async function buildTurnContent(
  text: string,
  attachments: readonly AttachmentType[],
  opts: BuildTurnContentOptions,
): Promise<TurnContent> {
  if (attachments.length === 0) return text;

  const inlineBlocks: ContentBlock[] = [];
  const diskAttachments: { att: AttachmentType; index: number }[] = [];
  attachments.forEach((att, index) => {
    if (isInlineImage(att.mimeType)) {
      inlineBlocks.push(buildImageBlock(att));
    } else if (isInlinePdf(att.mimeType)) {
      inlineBlocks.push(buildDocumentBlock(att));
    } else {
      diskAttachments.push({ att, index });
    }
  });

  let diskPaths: string[] = [];
  if (diskAttachments.length > 0) {
    const dir = uploadsDirFor(opts);
    await fs.mkdir(dir, { recursive: true });
    diskPaths = await Promise.all(
      diskAttachments.map(({ att, index }) =>
        writeDiskAttachment(att, index, dir),
      ),
    );
  }

  const combinedText = joinTextSections(text, diskPaths);

  // No image/PDF to inline → keep the simple string path (with any disk-file
  // references folded into the text).
  if (inlineBlocks.length === 0) return combinedText;

  const blocks: ContentBlock[] = [];
  if (combinedText.length > 0)
    blocks.push({ type: "text", text: combinedText });
  blocks.push(...inlineBlocks);
  return blocks;
}
