import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { query } from "../fixtures/mock-claude/index.js";

const SCRIPT_PATH = resolve(
  __dirname,
  "../fixtures/mock-claude/scripts/list-files.json",
);

const EXPECTED_TYPES: readonly string[] = [
  "system",
  "stream_event",
  "assistant",
  "assistant",
  "user",
  "stream_event",
  "assistant",
  "result",
];

describe("mock-claude SDK", () => {
  it("yields the SDK-shaped messages from the list-files script", async () => {
    const stream = query({ prompt: "list files", scriptPath: SCRIPT_PATH });
    const types: string[] = [];
    for await (const message of stream) {
      types.push(message.type);
    }
    expect(types).toEqual(EXPECTED_TYPES);
  });

  it("falls back to MOCK_CLAUDE_SCRIPT env when no scriptPath", async () => {
    process.env.MOCK_CLAUDE_SCRIPT = SCRIPT_PATH;
    const stream = query({ prompt: "list files" });
    let count = 0;
    for await (const _ of stream) {
      count++;
    }
    expect(count).toBe(EXPECTED_TYPES.length);
  });
});
