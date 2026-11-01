import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  PREVIEW_BLOCKS_TOOL_DESCRIPTION,
  PREVIEW_BLOCKS_TOOL_NAME,
  PREVIEW_ERROR_BYTES,
  PREVIEW_ERROR_CODES,
  PREVIEW_ERROR_DEPTH,
  PREVIEW_ERROR_EMPTY_VIEW,
  PREVIEW_ERROR_NO_ATTACHMENTS,
  PREVIEW_ERROR_NO_TYPE,
  PREVIEW_ERROR_NODES,
  PREVIEW_ERROR_OPTION_URL,
  PREVIEW_ERROR_SKETCH,
  PREVIEW_ERROR_UNKNOWN_ATTACHMENT,
  PREVIEW_ERROR_URL,
  PREVIEW_LATEST_ATTACHMENT_ID,
  PREVIEW_MAX_CAPTION_CHARS,
  PREVIEW_MAX_DEPTH,
  PREVIEW_MAX_DESCRIPTION_CHARS,
  PREVIEW_MAX_JSON_BYTES,
  PREVIEW_MAX_LABEL_CHARS,
  PREVIEW_MAX_NODES,
  PREVIEW_MAX_TITLE_CHARS,
  PREVIEW_MAX_URL_CHARS,
  PREVIEW_MAX_VARIANTS,
  PREVIEW_REMOTE_URL,
  PREVIEW_RESULT_SHOWN,
  PREVIEW_SAME_ORIGIN_PATH,
  PREVIEW_SKETCH_FORBIDDEN,
  PREVIEW_URL_OPTION_KEY,
} from "../../constants/preview.js";
import {
  type BlockPreviewReferenceType,
  type BlockPreviewType,
  type PreviewNodeType,
  type PreviewSketchType,
  type PreviewTreeType,
  PreviewSketchSchema,
  PreviewTreeSchema,
  PreviewVariantSchema,
} from "../../protocol/preview.js";
import { defineTool, type McpToolResult } from "../define-tool.js";

export interface PreviewBlocksDeps {
  showPreview: (preview: BlockPreviewType) => void;
  /** Names of the images the user attached in this conversation, oldest first. */
  listAttachedImages: () => string[];
}

const ReferenceInputSchema = z
  .object({
    attachmentId: z
      .string()
      .optional()
      .describe(
        `File name of an image the user attached in this conversation, or \`${PREVIEW_LATEST_ATTACHMENT_ID}\` for the last one.`,
      ),
    url: z
      .string()
      .max(PREVIEW_MAX_URL_CHARS)
      .optional()
      .describe(
        "Same-origin path of an image (e.g. a media URL). An external URL is only shown as a link.",
      ),
    caption: z
      .string()
      .max(PREVIEW_MAX_CAPTION_CHARS)
      .optional()
      .describe("What the reference shows, e.g. `Your mockup`."),
  })
  .describe("The user's mockup to show side by side with the blocks.");

const INPUT_SCHEMA = {
  title: z
    .string()
    .min(1)
    .max(PREVIEW_MAX_TITLE_CHARS)
    .describe("Attachment title, e.g. `Revenue card: DMS KpiCard`."),
  description: z
    .string()
    .max(PREVIEW_MAX_DESCRIPTION_CHARS)
    .optional()
    .describe("What to look at: the visible differences from the mockup."),
  label: z
    .string()
    .min(1)
    .max(PREVIEW_MAX_LABEL_CHARS)
    .optional()
    .describe(
      "Tab label of the main view when there are variants, e.g. `DMS KpiCard`.",
    ),
  tree: PreviewTreeSchema.optional(),
  sketch: PreviewSketchSchema.optional(),
  reference: ReferenceInputSchema.optional(),
  variants: z
    .array(PreviewVariantSchema)
    .max(PREVIEW_MAX_VARIANTS)
    .optional()
    .describe(
      "Alternatives shown as tabs after the main view, e.g. the same block with other options, or a custom `sketch`.",
    ),
} as const;

type ReferenceInput = z.infer<typeof ReferenceInputSchema>;
type VariantInput = z.infer<typeof PreviewVariantSchema>;

interface PreviewView {
  tree?: PreviewTreeType;
  sketch?: PreviewSketchType;
}

interface PreviewInput extends PreviewView {
  title: string;
  description?: string;
  label?: string;
  reference?: ReferenceInput;
  variants?: VariantInput[];
}

class PreviewInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface TreeStats {
  nodes: number;
}

function rootsOf(tree: PreviewTreeType): PreviewNodeType[] {
  return Array.isArray(tree) ? tree : [tree];
}

const OPTION_URL = z.string();

function checkOptionUrls(node: PreviewNodeType): void {
  const offending = Object.entries(node.options ?? {}).find(([key, value]) => {
    if (!PREVIEW_URL_OPTION_KEY.test(key)) return false;
    const url = OPTION_URL.safeParse(value);
    return url.success && !PREVIEW_SAME_ORIGIN_PATH.test(url.data);
  });
  if (offending === undefined) return;
  throw new PreviewInputError(
    PREVIEW_ERROR_CODES.INVALID_TREE,
    `${PREVIEW_ERROR_OPTION_URL}${offending[0]}`,
  );
}

function checkNode(node: PreviewNodeType, depth: number, stats: TreeStats) {
  if (depth > PREVIEW_MAX_DEPTH)
    throw new PreviewInputError(
      PREVIEW_ERROR_CODES.INVALID_TREE,
      PREVIEW_ERROR_DEPTH,
    );
  if (node.type === undefined && node.componentName === undefined)
    throw new PreviewInputError(
      PREVIEW_ERROR_CODES.INVALID_TREE,
      PREVIEW_ERROR_NO_TYPE,
    );
  checkOptionUrls(node);
  stats.nodes += 1;
  if (stats.nodes > PREVIEW_MAX_NODES)
    throw new PreviewInputError(
      PREVIEW_ERROR_CODES.TOO_LARGE,
      PREVIEW_ERROR_NODES,
    );
  for (const child of node.children ?? []) checkNode(child, depth + 1, stats);
}

function checkSketch(sketch: PreviewSketchType): void {
  const markup = `${sketch.html}\n${sketch.css ?? ""}`;
  const refused = PREVIEW_SKETCH_FORBIDDEN.find(([pattern]) =>
    pattern.test(markup),
  );
  if (refused === undefined) return;
  throw new PreviewInputError(
    PREVIEW_ERROR_CODES.INVALID_SKETCH,
    `${PREVIEW_ERROR_SKETCH}${refused[1]}.`,
  );
}

function checkView(view: PreviewView, stats: TreeStats): void {
  if (view.tree === undefined && view.sketch === undefined)
    throw new PreviewInputError(
      PREVIEW_ERROR_CODES.INVALID_TREE,
      PREVIEW_ERROR_EMPTY_VIEW,
    );
  for (const root of view.tree === undefined ? [] : rootsOf(view.tree))
    checkNode(root, 1, stats);
  if (view.sketch !== undefined) checkSketch(view.sketch);
}

function checkViews(input: PreviewInput): void {
  const views: PreviewView[] = [input, ...(input.variants ?? [])];
  const stats: TreeStats = { nodes: 0 };
  for (const view of views) checkView(view, stats);
  const content = views.map(({ tree, sketch }) => ({ tree, sketch }));
  const bytes = Buffer.byteLength(JSON.stringify(content));
  if (bytes > PREVIEW_MAX_JSON_BYTES)
    throw new PreviewInputError(
      PREVIEW_ERROR_CODES.TOO_LARGE,
      PREVIEW_ERROR_BYTES,
    );
}

function resolveAttachment(requested: string, attached: string[]): string {
  if (attached.length === 0)
    throw new PreviewInputError(
      PREVIEW_ERROR_CODES.UNKNOWN_ATTACHMENT,
      PREVIEW_ERROR_NO_ATTACHMENTS,
    );
  if (requested === PREVIEW_LATEST_ATTACHMENT_ID)
    return attached.at(-1) ?? requested;
  if (attached.includes(requested)) return requested;
  throw new PreviewInputError(
    PREVIEW_ERROR_CODES.UNKNOWN_ATTACHMENT,
    `${PREVIEW_ERROR_UNKNOWN_ATTACHMENT}${attached.join(", ")}`,
  );
}

function checkUrl(url: string): string {
  if (PREVIEW_SAME_ORIGIN_PATH.test(url) || PREVIEW_REMOTE_URL.test(url))
    return url;
  throw new PreviewInputError(
    PREVIEW_ERROR_CODES.INVALID_URL,
    PREVIEW_ERROR_URL,
  );
}

function resolveReference(
  reference: ReferenceInput | undefined,
  attached: () => string[],
): BlockPreviewReferenceType | undefined {
  if (reference === undefined) return undefined;
  const { attachmentId, url, caption } = reference;
  return {
    attachmentName:
      attachmentId === undefined
        ? undefined
        : resolveAttachment(attachmentId, attached()),
    url: url === undefined ? undefined : checkUrl(url),
    caption,
  };
}

function buildPreview(
  input: PreviewInput,
  deps: PreviewBlocksDeps,
): BlockPreviewType {
  checkViews(input);
  return {
    id: randomUUID(),
    title: input.title,
    description: input.description,
    label: input.label,
    tree: input.tree,
    sketch: input.sketch,
    reference: resolveReference(input.reference, deps.listAttachedImages),
    variants: input.variants,
    timestampMs: Date.now(),
  };
}

function textContent(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}

function errorContent(error: PreviewInputError): McpToolResult {
  return {
    ...textContent(
      JSON.stringify({
        ok: false,
        error: { code: error.code },
        message: error.message,
      }),
    ),
    isError: true,
  };
}

export function buildPreviewBlocksTool(deps: PreviewBlocksDeps) {
  return defineTool(
    PREVIEW_BLOCKS_TOOL_NAME,
    PREVIEW_BLOCKS_TOOL_DESCRIPTION,
    INPUT_SCHEMA,
    async (input: PreviewInput) => {
      try {
        const preview = buildPreview(input, deps);
        deps.showPreview(preview);
        return textContent(
          JSON.stringify({
            ok: true,
            data: { previewId: preview.id },
            message: PREVIEW_RESULT_SHOWN,
          }),
        );
      } catch (error) {
        if (!(error instanceof PreviewInputError)) throw error;
        return errorContent(error);
      }
    },
  );
}
