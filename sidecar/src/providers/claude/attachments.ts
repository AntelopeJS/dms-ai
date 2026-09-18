import fs from "node:fs/promises";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  joinTextSections,
  uploadsDirFor as sharedUploadsDirFor,
  writeDiskAttachment,
} from "../../agent/attachment-files.js";
import {
  INLINE_IMAGE_MEDIA_TYPES,
  type InlineImageMediaType,
  PDF_MEDIA_TYPE,
} from "../../constants/attachments.js";
import type { AttachmentType } from "../../protocol/messages.js";

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

function uploadsDirFor(opts: BuildTurnContentOptions): string {
  return sharedUploadsDirFor(opts.hostProjectRoot, opts.conversationId);
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
