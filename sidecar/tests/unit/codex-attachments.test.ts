import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AttachmentType } from "../../src/protocol/messages.js";
import { buildCodexTurnInput } from "../../src/providers/codex/attachments.js";

const TMP_PREFIX = "dms-ai-attach-";
const CONVERSATION = "conv-attach";

// Smallest valid one-page PDF: enough for a rasterizer to produce a page.
const MINIMAL_PDF = [
  "%PDF-1.4",
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj",
  "trailer<</Root 1 0 R>>",
  "%%EOF",
].join("\n");

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function attachment(
  name: string,
  mimeType: string,
  data: string,
): AttachmentType {
  return { name, mimeType, size: Buffer.from(data, "base64").length, data };
}

describe("codex turn input", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), TMP_PREFIX));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("passes plain text straight through when nothing is attached", async () => {
    const input = await buildCodexTurnInput("hello", [], {
      hostProjectRoot: root,
      conversationId: CONVERSATION,
    });
    expect(input).toEqual([{ type: "text", text: "hello", text_elements: [] }]);
  });

  it("hands an image over as a local image path the model can perceive", async () => {
    const input = await buildCodexTurnInput(
      "look",
      [attachment("shot.png", "image/png", PNG_BASE64)],
      { hostProjectRoot: root, conversationId: CONVERSATION },
    );
    const images = input.filter((item) => item.type === "localImage");
    expect(images).toHaveLength(1);
    const written = await readFile((images[0] as { path: string }).path);
    expect(written.length).toBeGreaterThan(0);
  });

  it("references a non-perceivable file by absolute path in the text", async () => {
    const input = await buildCodexTurnInput(
      "read this",
      [
        attachment(
          "notes.txt",
          "text/plain",
          Buffer.from("hello").toString("base64"),
        ),
      ],
      { hostProjectRoot: root, conversationId: CONVERSATION },
    );
    expect(input.filter((item) => item.type === "localImage")).toHaveLength(0);
    const text = (input[0] as { text: string }).text;
    expect(text).toContain("[Attached file:");
    expect(text).toContain("notes.txt");
  });

  it("rasterizes a PDF into pages, or falls back to referencing it", async () => {
    const pdfPath = join(root, "probe.pdf");
    await writeFile(pdfPath, MINIMAL_PDF);
    const input = await buildCodexTurnInput(
      "summarize",
      [
        attachment(
          "doc.pdf",
          "application/pdf",
          Buffer.from(MINIMAL_PDF).toString("base64"),
        ),
      ],
      { hostProjectRoot: root, conversationId: CONVERSATION },
    );
    const images = input.filter((item) => item.type === "localImage");
    const text = (input[0] as { text: string }).text;
    // Either poppler produced pages, or the file is referenced by path —
    // never silently dropped.
    expect(images.length > 0 || text.includes("[Attached file:")).toBe(true);
  });
});
