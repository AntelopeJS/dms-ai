import { z } from "zod";
import {
  PREVIEW_MAX_CAPTION_CHARS,
  PREVIEW_MAX_DESCRIPTION_CHARS,
  PREVIEW_MAX_LABEL_CHARS,
  PREVIEW_MAX_ROOTS,
  PREVIEW_MAX_TITLE_CHARS,
  PREVIEW_MAX_URL_CHARS,
  PREVIEW_MAX_VARIANTS,
} from "../constants/preview.js";

/**
 * One node of a block tree the chat renders with the DMS `DmsBlockPreview`
 * component. Mirrors the DMS preview contract: a registry block `type` (or its
 * `componentName`), its options, and its children with their slot.
 */
export const PreviewNodeSchema = z.object({
  type: z
    .string()
    .optional()
    .describe("Block type from BuilderCatalog, e.g. `KpiCard`."),
  componentName: z
    .string()
    .optional()
    .describe(
      "Registered block component name, e.g. `dms-kpi-card`; only when `type` is unknown.",
    ),
  options: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "The block's options, as its declaration takes them. A `fetchUrl` must be a same-origin path.",
    ),
  id: z.string().optional().describe("Child id, unique among its siblings."),
  slot: z
    .string()
    .optional()
    .describe("Slot of the parent the child renders in, when it has several."),
  colSpan: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Columns a GridRow child spans."),
  get children() {
    return z
      .array(PreviewNodeSchema)
      .optional()
      .describe("Nested blocks, in order.");
  },
});

export const PreviewTreeSchema = z
  .union([
    PreviewNodeSchema,
    z.array(PreviewNodeSchema).min(1).max(PREVIEW_MAX_ROOTS),
  ])
  .describe("One block, or a list of blocks stacked in order.");

export const PreviewVariantSchema = z.object({
  label: z
    .string()
    .min(1)
    .max(PREVIEW_MAX_LABEL_CHARS)
    .describe("Tab label, e.g. `Compact` or `With chart`."),
  tree: PreviewTreeSchema,
});

export const BlockPreviewReferenceSchema = z.object({
  attachmentName: z.string().optional(),
  url: z.string().max(PREVIEW_MAX_URL_CHARS).optional(),
  caption: z.string().max(PREVIEW_MAX_CAPTION_CHARS).optional(),
});

export const BlockPreviewSchema = z.object({
  id: z.string(),
  title: z.string().max(PREVIEW_MAX_TITLE_CHARS),
  description: z.string().max(PREVIEW_MAX_DESCRIPTION_CHARS).optional(),
  tree: PreviewTreeSchema,
  reference: BlockPreviewReferenceSchema.optional(),
  variants: z.array(PreviewVariantSchema).max(PREVIEW_MAX_VARIANTS).optional(),
  timestampMs: z.number(),
});

export type PreviewNodeType = z.infer<typeof PreviewNodeSchema>;
export type PreviewTreeType = z.infer<typeof PreviewTreeSchema>;
export type BlockPreviewType = z.infer<typeof BlockPreviewSchema>;
export type BlockPreviewReferenceType = z.infer<
  typeof BlockPreviewReferenceSchema
>;
