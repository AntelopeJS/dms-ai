import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  PREVIEW_BLOCKS_TOOL_NAME,
  PREVIEW_ERROR_CODES,
  PREVIEW_LATEST_ATTACHMENT_ID,
  PREVIEW_MAX_DEPTH,
  PREVIEW_MAX_JSON_BYTES,
  PREVIEW_MAX_NODES,
  PREVIEW_MAX_VARIANTS,
  PREVIEW_SKETCH_MAX_HEIGHT_PX,
} from "../../src/constants/preview.js";
import { buildPreviewBlocksTool } from "../../src/mcp/tools/preview-blocks.js";
import {
  AnyServerEvent,
  type AnyServerEventType,
  EVENT_TYPES,
} from "../../src/protocol/events.js";
import type {
  BlockPreviewType,
  PreviewNodeType,
} from "../../src/protocol/preview.js";
import {
  buildSnapshotEvent,
  emitBlockPreview,
  listAttachedImages,
} from "../../src/server/chat-events.js";
import type { SidecarServices } from "../../src/server/services.js";
import { createConversationStore } from "../../src/state/conversations.js";
import { createStore } from "../../src/state/store.js";

const CONVERSATION_ID = "conv-preview";
const MOCKUP_NAME = "mockup.png";
const LATER_MOCKUP_NAME = "mockup-v2.png";
const KPI_NODE: PreviewNodeType = {
  type: "KpiCard",
  options: { label: "Revenue", value: "12 400 €" },
};
const SKETCH = {
  html: '<article class="card"><h3>Revenue</h3><p class="value">12 400 €</p><img alt="" src="data:image/png;base64,AA"><a href="#trend">Trend</a></article>',
  css: ".card { background: var(--sketch-surface); background-image: url('data:image/svg+xml,%3Csvg%3E%3C/svg%3E'); }",
  caption: "Revenue card with a sparkline",
  height: 240,
};

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface ToolLike {
  name: string;
  schema: z.ZodRawShape;
  handler: (
    args: Record<string, unknown>,
    extra: unknown,
  ) => Promise<ToolResult>;
}

interface Harness {
  shown: BlockPreviewType[];
  tool: ToolLike;
}

function buildHarness(attached: string[] = []): Harness {
  const shown: BlockPreviewType[] = [];
  const tool = buildPreviewBlocksTool({
    showPreview: (preview) => shown.push(preview),
    listAttachedImages: () => attached,
  }) as unknown as ToolLike;
  return { shown, tool };
}

function parse(result: ToolResult): Record<string, any> {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

function nested(depth: number): PreviewNodeType {
  if (depth <= 1) return { type: "KpiCard" };
  return { type: "Section", children: [nested(depth - 1)] };
}

describe("PreviewBlocks tool", () => {
  it("is named PreviewBlocks", () => {
    expect(buildHarness().tool.name).toBe(PREVIEW_BLOCKS_TOOL_NAME);
  });

  it("publishes a JSON schema with the recursive tree", () => {
    const json = z.toJSONSchema(z.object(buildHarness().tool.schema));
    expect(JSON.stringify(json)).toContain("children");
  });

  it("rejects more variants than the cap before the handler runs", () => {
    const variants = Array.from(
      { length: PREVIEW_MAX_VARIANTS + 1 },
      (_, i) => ({
        label: `V${i}`,
        tree: KPI_NODE,
      }),
    );
    const parsed = z
      .object(buildHarness().tool.schema)
      .safeParse({ title: "Too many", tree: KPI_NODE, variants });
    expect(parsed.success).toBe(false);
  });

  it("shows the preview and returns its id at once", async () => {
    const { shown, tool } = buildHarness();
    const result = await tool.handler(
      { title: "Revenue card", description: "Rounded corners", tree: KPI_NODE },
      {},
    );
    const body = parse(result);
    expect(body.ok).toBe(true);
    expect(shown).toHaveLength(1);
    expect(body.data.previewId).toBe(shown[0]?.id);
    expect(shown[0]).toMatchObject({
      title: "Revenue card",
      description: "Rounded corners",
      tree: KPI_NODE,
    });
  });

  it("keeps variants in order", async () => {
    const { shown, tool } = buildHarness();
    const variants = [
      { label: "Compact", tree: [KPI_NODE] },
      { label: "Detailed", tree: { ...KPI_NODE, options: { trend: 4 } } },
    ];
    await tool.handler({ title: "Cards", tree: KPI_NODE, variants }, {});
    expect(shown[0]?.variants?.map((variant) => variant.label)).toEqual([
      "Compact",
      "Detailed",
    ]);
  });

  it("refuses a node with neither type nor componentName", async () => {
    const { shown, tool } = buildHarness();
    const result = await tool.handler(
      { title: "Bad", tree: { options: { a: 1 } } },
      {},
    );
    expect(result.isError).toBe(true);
    expect(parse(result).error.code).toBe(PREVIEW_ERROR_CODES.INVALID_TREE);
    expect(shown).toHaveLength(0);
  });

  it("refuses a block loading from another origin", async () => {
    const { shown, tool } = buildHarness();
    const result = await tool.handler(
      {
        title: "Remote",
        tree: {
          type: "KpiCard",
          options: { fetchUrl: "https://x.example/kpi" },
        },
      },
      {},
    );
    const body = parse(result);
    expect(body.error.code).toBe(PREVIEW_ERROR_CODES.INVALID_TREE);
    expect(body.message).toContain("fetchUrl");
    expect(shown).toHaveLength(0);
  });

  it("keeps a same-origin fetchUrl and a child's colSpan", async () => {
    const { shown, tool } = buildHarness();
    const tree = {
      type: "GridRow",
      children: [
        { type: "KpiCard", colSpan: 2, options: { fetchUrl: "/api/kpi" } },
      ],
    };
    await tool.handler({ title: "Local", tree }, {});
    expect(shown[0]?.tree).toEqual(tree);
  });

  it("refuses a tree nested too deep", async () => {
    const { tool } = buildHarness();
    const result = await tool.handler(
      { title: "Deep", tree: nested(PREVIEW_MAX_DEPTH + 1) },
      {},
    );
    expect(parse(result).error.code).toBe(PREVIEW_ERROR_CODES.INVALID_TREE);
  });

  it("counts the nodes of every variant against the cap", async () => {
    const { tool } = buildHarness();
    const half = Math.ceil(PREVIEW_MAX_NODES / 2) + 1;
    const many = Array.from({ length: half }, () => KPI_NODE);
    const section = { type: "Section", children: many };
    const result = await tool.handler(
      {
        title: "Big",
        tree: section,
        variants: [{ label: "B", tree: section }],
      },
      {},
    );
    expect(parse(result).error.code).toBe(PREVIEW_ERROR_CODES.TOO_LARGE);
  });

  it("refuses a preview over the JSON size cap", async () => {
    const { tool } = buildHarness();
    const huge = { type: "Text", options: { text: "x".repeat(70_000) } };
    const result = await tool.handler({ title: "Huge", tree: huge }, {});
    expect(parse(result).error.code).toBe(PREVIEW_ERROR_CODES.TOO_LARGE);
  });

  it("resolves `latest` to the last image the user attached", async () => {
    const { shown, tool } = buildHarness([MOCKUP_NAME, LATER_MOCKUP_NAME]);
    await tool.handler(
      {
        title: "Card",
        tree: KPI_NODE,
        reference: {
          attachmentId: PREVIEW_LATEST_ATTACHMENT_ID,
          caption: "Your mockup",
        },
      },
      {},
    );
    expect(shown[0]?.reference).toEqual({
      attachmentName: LATER_MOCKUP_NAME,
      url: undefined,
      caption: "Your mockup",
    });
  });

  it("accepts an attachment by name", async () => {
    const { shown, tool } = buildHarness([MOCKUP_NAME, LATER_MOCKUP_NAME]);
    await tool.handler(
      {
        title: "Card",
        tree: KPI_NODE,
        reference: { attachmentId: MOCKUP_NAME },
      },
      {},
    );
    expect(shown[0]?.reference?.attachmentName).toBe(MOCKUP_NAME);
  });

  it("lists the attached images when the name is unknown", async () => {
    const { shown, tool } = buildHarness([MOCKUP_NAME]);
    const result = await tool.handler(
      {
        title: "Card",
        tree: KPI_NODE,
        reference: { attachmentId: "nope.png" },
      },
      {},
    );
    const body = parse(result);
    expect(body.error.code).toBe(PREVIEW_ERROR_CODES.UNKNOWN_ATTACHMENT);
    expect(body.message).toContain(MOCKUP_NAME);
    expect(shown).toHaveLength(0);
  });

  it("refuses an attachment when the user attached no image", async () => {
    const { tool } = buildHarness();
    const result = await tool.handler(
      {
        title: "Card",
        tree: KPI_NODE,
        reference: { attachmentId: PREVIEW_LATEST_ATTACHMENT_ID },
      },
      {},
    );
    expect(parse(result).error.code).toBe(
      PREVIEW_ERROR_CODES.UNKNOWN_ATTACHMENT,
    );
  });

  it.each(["/media/mockup.png", "https://example.com/mockup.png"])(
    "accepts the reference url %s",
    async (url) => {
      const { shown, tool } = buildHarness();
      await tool.handler(
        { title: "Card", tree: KPI_NODE, reference: { url } },
        {},
      );
      expect(shown[0]?.reference?.url).toBe(url);
    },
  );

  it.each([
    "//evil.example/x.png",
    "javascript:alert(1)",
    "data:image/png;base64,AA",
  ])("refuses the reference url %s", async (url) => {
    const { shown, tool } = buildHarness();
    const result = await tool.handler(
      { title: "Card", tree: KPI_NODE, reference: { url } },
      {},
    );
    expect(parse(result).error.code).toBe(PREVIEW_ERROR_CODES.INVALID_URL);
    expect(shown).toHaveLength(0);
  });
});

describe("PreviewBlocks sketches", () => {
  it("shows a sketch beside the DMS tree, with a main tab label", async () => {
    const { shown, tool } = buildHarness();
    const result = await tool.handler(
      {
        title: "Revenue card",
        label: "DMS KpiCard",
        tree: KPI_NODE,
        variants: [{ label: "Custom sketch", sketch: SKETCH }],
      },
      {},
    );
    expect(parse(result).ok).toBe(true);
    expect(shown[0]).toMatchObject({
      label: "DMS KpiCard",
      tree: KPI_NODE,
      variants: [{ label: "Custom sketch", sketch: SKETCH }],
    });
  });

  it("accepts a sketch as the only view", async () => {
    const { shown, tool } = buildHarness();
    await tool.handler({ title: "Custom", sketch: { html: "<p>Hi</p>" } }, {});
    expect(shown[0]?.tree).toBeUndefined();
    expect(shown[0]?.sketch).toEqual({ html: "<p>Hi</p>" });
  });

  it("refuses a view with neither tree nor sketch", async () => {
    const { shown, tool } = buildHarness();
    const result = await tool.handler(
      { title: "Empty", tree: KPI_NODE, variants: [{ label: "Nothing" }] },
      {},
    );
    expect(parse(result).error.code).toBe(PREVIEW_ERROR_CODES.INVALID_TREE);
    expect(shown).toHaveLength(0);
  });

  it.each([
    ["a script", { html: "<p>x</p><script>alert(1)</script>" }],
    ["a spaced script tag", { html: "< SCRIPT src=x></script>" }],
    ["an event handler", { html: '<img src="data:," onerror="alert(1)">' }],
    ["a slash-led handler", { html: "<svg/onload=alert(1)>" }],
    ["a javascript: link", { html: '<a href="javascript:alert(1)">x</a>' }],
    ["an iframe", { html: '<iframe src="data:text/html,x"></iframe>' }],
    ["an object", { html: '<object data="data:,x"></object>' }],
    ["an embed", { html: "<embed>" }],
    ["a stylesheet link", { html: '<link rel="stylesheet">' }],
    ["a base", { html: "<base>" }],
    ["a meta refresh", { html: '<meta http-equiv="refresh" content="0">' }],
    ["a remote image", { html: '<img src="https://x.example/a.png">' }],
    ["a relative image", { html: "<img src=/media/a.png>" }],
    ["a remote link", { html: '<a href="https://x.example">x</a>' }],
    ["a remote srcset", { html: '<img srcset="https://x.example/a.png 2x">' }],
    [
      "a remote CSS url",
      {
        html: "<p>x</p>",
        css: "p { background: url(https://x.example/a.png) }",
      },
    ],
    [
      "a quoted remote CSS url",
      { html: "<p>x</p>", css: "p { background: url( 'https://x' ) }" },
    ],
    [
      "an inline style url",
      { html: '<p style="background:url(//x.example/a)">x</p>' },
    ],
    ["a CSS import", { html: "<p>x</p>", css: "@import 'data:text/css,p{}';" }],
  ])("refuses a sketch with %s", async (_label, sketch) => {
    const { shown, tool } = buildHarness();
    const result = await tool.handler(
      { title: "Sketch", tree: KPI_NODE, variants: [{ label: "S", sketch }] },
      {},
    );
    expect(result.isError).toBe(true);
    expect(parse(result).error.code).toBe(PREVIEW_ERROR_CODES.INVALID_SKETCH);
    expect(shown).toHaveLength(0);
  });

  it("keeps words that only look like handlers outside a tag", async () => {
    const { shown, tool } = buildHarness();
    await tool.handler(
      { title: "Text", sketch: { html: "<p>Status: on hold = 3 orders</p>" } },
      {},
    );
    expect(shown).toHaveLength(1);
  });

  it("counts sketches against the size cap", async () => {
    const { tool } = buildHarness();
    const half = "x".repeat(PREVIEW_MAX_JSON_BYTES / 2);
    const result = await tool.handler(
      {
        title: "Huge",
        sketch: { html: `<p>${half}</p>` },
        variants: [{ label: "B", sketch: { html: `<p>${half}</p>` } }],
      },
      {},
    );
    expect(parse(result).error.code).toBe(PREVIEW_ERROR_CODES.TOO_LARGE);
  });

  it("bounds the sketch height in the schema", () => {
    const schema = z.object(buildHarness().tool.schema);
    const tall = { html: "<p>x</p>", height: PREVIEW_SKETCH_MAX_HEIGHT_PX + 1 };
    expect(schema.safeParse({ title: "T", sketch: tall }).success).toBe(false);
  });
});

describe("block preview transcript", () => {
  let dir: string;
  let sent: AnyServerEventType[];
  let services: SidecarServices;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-preview-"));
    sent = [];
    const store = createStore({ filePath: join(dir, "state.json") });
    const conversationStore = createConversationStore({ store });
    await conversationStore.loadFromDisk();
    services = {
      conversationStore,
      chatSocketRegistry: {
        send: (_id: string, event: AnyServerEventType) => sent.push(event),
      },
      checkpoints: { forConversation: () => [] },
      conversationModes: {
        describe: (conversationId: string) => ({
          conversationId,
          mode: "normal",
          generationMode: "safe",
          fullAuto: null,
        }),
      },
    } as unknown as SidecarServices;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const preview: BlockPreviewType = {
    id: "preview-1",
    title: "Revenue card",
    tree: KPI_NODE,
    timestampMs: 1_000,
  };

  it("sends a valid block_preview event", () => {
    emitBlockPreview(services, CONVERSATION_ID, preview);
    expect(sent).toHaveLength(1);
    const event = AnyServerEvent.parse(sent[0]);
    expect(event.type).toBe(EVENT_TYPES.BLOCK_PREVIEW);
  });

  it("sends and stores a sketch-only preview", () => {
    const sketched: BlockPreviewType = {
      id: "preview-2",
      title: "Custom card",
      sketch: SKETCH,
      timestampMs: 2_000,
    };
    emitBlockPreview(services, CONVERSATION_ID, sketched);
    expect(AnyServerEvent.parse(sent[0])).toMatchObject({ preview: sketched });
    const snapshot = buildSnapshotEvent(services, CONVERSATION_ID);
    expect(snapshot?.messages[0]?.preview).toEqual(sketched);
  });

  it("keeps the preview in the snapshot a reload reads", () => {
    emitBlockPreview(services, CONVERSATION_ID, preview);
    const snapshot = buildSnapshotEvent(services, CONVERSATION_ID);
    expect(snapshot?.messages).toEqual([
      { role: "block_preview", content: "", preview, timestampMs: 1_000 },
    ]);
  });

  it("lists only the images the user attached, oldest first", () => {
    const attachments = [
      { name: MOCKUP_NAME, mimeType: "image/png", size: 10 },
      { name: "notes.txt", mimeType: "text/plain", size: 10 },
    ];
    services.conversationStore.appendMessage(CONVERSATION_ID, {
      role: "user",
      content: "like this",
      attachments,
      timestampMs: 1,
    });
    services.conversationStore.appendMessage(CONVERSATION_ID, {
      role: "user",
      content: "or this",
      attachments: [
        { name: LATER_MOCKUP_NAME, mimeType: "image/webp", size: 10 },
      ],
      timestampMs: 2,
    });
    expect(listAttachedImages(services, CONVERSATION_ID)).toEqual([
      MOCKUP_NAME,
      LATER_MOCKUP_NAME,
    ]);
  });
});
