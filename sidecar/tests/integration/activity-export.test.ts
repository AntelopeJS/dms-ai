import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  callApi,
  startWsHarness,
  type WsHarness,
} from "../helpers/ws-harness.js";

const CONVERSATION_ID = "many-reads";
const RECORDS = 10_005;
const MS_PER_DAY = 86_400_000;
const TEST_TIMEOUT_MS = 60_000;

const PAGE = z.looseObject({
  total: z.number(),
  results: z.array(z.looseObject({ target: z.string().optional() })),
});

function seedReads(harness: WsHarness): void {
  const store = harness.conversationStore;
  const start = Date.now() - MS_PER_DAY;
  store.appendMessage(CONVERSATION_ID, {
    role: "user",
    content: "Many reads",
    timestampMs: start - 1000,
  });
  for (let index = 0; index < RECORDS; index += 1) {
    const at = start + index * 1000;
    const callId = `r-${index}`;
    store.appendMessage(CONVERSATION_ID, {
      role: "tool_use",
      toolName: "Read",
      callId,
      content: JSON.stringify({ file_path: `docs/${index}.md` }),
      timestampMs: at,
      allowedBy: "read_auto",
    });
    store.appendMessage(CONVERSATION_ID, {
      role: "tool_result",
      callId,
      content: "ok",
      status: "success",
      timestampMs: at + 100,
      allowedBy: "read_auto",
    });
  }
}

async function page(harness: WsHarness, path: string) {
  const response = await callApi(harness.port, path);
  expect(response.status).toBe(200);
  return PAGE.parse(await response.json());
}

describe("the activity export", () => {
  let harness: WsHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it(
    "holds 10,000 rows, newest first, while a list page stays at 200",
    async () => {
      harness = await startWsHarness({ provider: "claude" });
      seedReads(harness);
      const exported = await page(harness, "/activity/export?limit=1");
      expect(exported.total).toBe(RECORDS);
      expect(exported.results).toHaveLength(10_000);
      expect(exported.results[0]?.target).toBe("docs/10004.md");
      expect(exported.results.at(-1)?.target).toBe("docs/5.md");
      const listed = await page(harness, "/activity?limit=10000");
      expect(listed.results).toHaveLength(200);
    },
    TEST_TIMEOUT_MS,
  );
});
