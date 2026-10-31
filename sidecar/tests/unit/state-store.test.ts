import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STATE_INITIAL } from "../../src/constants/state.js";
import { createConversationStore } from "../../src/state/conversations.js";
import { createStore } from "../../src/state/store.js";

const TMP_PREFIX = "dms-ai-state-";
const STATE_FILE = "state.json";
const FILE_ENCODING = "utf8";

describe("state file parsing", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    filePath = join(dir, STATE_FILE);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    ["conversations is null", '{"conversations": null}'],
    ["conversations is missing", "{}"],
    ["conversations is a number", '{"conversations": 3}'],
    ["conversations is a string", '{"conversations": "x"}'],
    ["the file is JSON null", "null"],
    ["the file is a number", "7"],
    ["the file is not JSON", "{not json"],
  ])("reads the empty state when %s", async (_label, contents) => {
    await writeFile(filePath, contents, FILE_ENCODING);
    const store = createStore({ filePath });
    expect(await store.read()).toEqual(STATE_INITIAL);
  });

  it("starts the conversation store empty from a file whose conversations is null", async () => {
    await writeFile(filePath, '{"conversations": null}', FILE_ENCODING);
    const conversations = createConversationStore({
      store: createStore({ filePath }),
    });
    await conversations.loadFromDisk();
    expect(conversations.list()).toEqual([]);
  });

  it("keeps the conversations of a well-formed file", async () => {
    const stored = {
      conversations: {
        "conv-1": { messages: [], createdAtMs: 1, updatedAtMs: 2 },
      },
    };
    await writeFile(filePath, JSON.stringify(stored), FILE_ENCODING);
    expect(await createStore({ filePath }).read()).toEqual(stored);
  });
});
