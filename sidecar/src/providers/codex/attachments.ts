import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  joinTextSections,
  uploadsDirFor,
  writeDiskAttachment,
} from "../../agent/attachment-files.js";
import {
  INLINE_IMAGE_MEDIA_TYPES,
  PDF_MEDIA_TYPE,
} from "../../constants/attachments.js";
import {
  PDF_RASTER_COMMAND,
  PDF_RASTER_DPI,
  PDF_RASTER_DPI_FLAG,
  PDF_RASTER_FORMAT_FLAG,
  PDF_RASTER_LAST_PAGE_FLAG,
  PDF_RASTER_MAX_PAGES,
  PDF_RASTER_PREFIX,
} from "../../constants/codex.js";
import type { AttachmentType } from "../../protocol/messages.js";
import type { v2 } from "./protocol/index.js";

const runCommand = promisify(execFile);

export interface CodexAttachmentContext {
  hostProjectRoot: string;
  conversationId: string;
}

interface RenderedAttachments {
  imagePaths: string[];
  diskPaths: string[];
}

function isPerceivableImage(mimeType: string): boolean {
  return (INLINE_IMAGE_MEDIA_TYPES as readonly string[]).includes(mimeType);
}

async function rasterizePdf(filePath: string): Promise<string[]> {
  const dir = path.dirname(filePath);
  const prefix = path.join(
    dir,
    `${path.basename(filePath)}-${PDF_RASTER_PREFIX}`,
  );
  try {
    await runCommand(PDF_RASTER_COMMAND, [
      PDF_RASTER_FORMAT_FLAG,
      PDF_RASTER_DPI_FLAG,
      PDF_RASTER_DPI,
      PDF_RASTER_LAST_PAGE_FLAG,
      String(PDF_RASTER_MAX_PAGES),
      filePath,
      prefix,
    ]);
  } catch {
    return [];
  }
  const entries = await fs.readdir(dir);
  return entries
    .filter((entry) => entry.startsWith(path.basename(prefix)))
    .sort()
    .map((entry) => path.join(dir, entry));
}

async function renderOne(
  attachment: AttachmentType,
  filePath: string,
  into: RenderedAttachments,
): Promise<void> {
  if (isPerceivableImage(attachment.mimeType)) {
    into.imagePaths.push(filePath);
    return;
  }
  if (attachment.mimeType === PDF_MEDIA_TYPE) {
    const pages = await rasterizePdf(filePath);
    if (pages.length > 0) {
      into.imagePaths.push(...pages);
      return;
    }
  }
  into.diskPaths.push(filePath);
}

/**
 * The turn payload Codex expects. Attachments always land on disk first: the
 * protocol takes image paths, not bytes. Images are handed over as `localImage`
 * so the model perceives them; a PDF is rasterized page by page for the same
 * reason, and anything else is referenced by absolute path in the text.
 */
export async function buildCodexTurnInput(
  text: string,
  attachments: readonly AttachmentType[],
  ctx: CodexAttachmentContext,
): Promise<v2.UserInput[]> {
  if (attachments.length === 0) {
    return [{ type: "text", text, text_elements: [] }];
  }
  const dir = uploadsDirFor(ctx.hostProjectRoot, ctx.conversationId);
  await fs.mkdir(dir, { recursive: true });
  const rendered: RenderedAttachments = { imagePaths: [], diskPaths: [] };
  for (const [index, attachment] of attachments.entries()) {
    const filePath = await writeDiskAttachment(attachment, index, dir);
    await renderOne(attachment, filePath, rendered);
  }
  const images: v2.UserInput[] = rendered.imagePaths.map((imagePath) => ({
    type: "localImage",
    path: imagePath,
  }));
  return [
    {
      type: "text",
      text: joinTextSections(text, rendered.diskPaths),
      text_elements: [],
    },
    ...images,
  ];
}
