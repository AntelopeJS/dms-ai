import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { MCP_TOOL_NAME_PREFIX } from "../../src/constants/mcp.js";
import { TOOL_LEXICON } from "../../src/constants/tool-lexicon.js";
import { createCodexAdapter } from "../../src/providers/codex/adapter.js";
import type { CodexNotification } from "../../src/providers/codex/client.js";

const DUMPS = resolve(__dirname, "../fixtures/codex-dumps");

interface DumpFrame {
  dir: string;
  msg: { id?: number | string; method?: string; params?: unknown };
}

// Only server-to-client notifications reach the adapter: a frame carrying both
// an id and a method is an approval request, which the permission layer owns.
function readNotifications(name: string): CodexNotification[] {
  const raw = readFileSync(resolve(DUMPS, name), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as DumpFrame)
    .filter((frame) => frame.dir === "in")
    .filter((frame) => frame.msg.method !== undefined)
    .filter((frame) => frame.msg.id === undefined)
    .map((frame) => ({
      method: frame.msg.method as string,
      params: frame.msg.params,
    }));
}

function replay(name: string): RunnerEvent[] {
  const adapter = createCodexAdapter();
  return readNotifications(name).flatMap((n) => adapter.handle(n));
}

function unpairedCallIds(events: RunnerEvent[]): string[] {
  const open = new Set<string>();
  for (const event of events) {
    if (event.type === "tool_use") open.add(event.callId);
    if (event.type === "tool_result") open.delete(event.callId);
  }
  return [...open];
}

const TURN_DUMPS = [
  "recette-1-simple-message.jsonl",
  "recette-2-file-edit.jsonl",
  "recette-3-command-denied.jsonl",
  "recette-4-accept-for-session.jsonl",
  "recette-5-safe-mode.jsonl",
  "recette-plan-todo.jsonl",
  "q1-readonly-write-escalation.jsonl",
  "q1b-readonly-command-no-write.jsonl",
  "q2-interrupt-mid-tool.jsonl",
];

describe("pairing across every recorded turn", () => {
  it.each(TURN_DUMPS)("leaves no tool_use unpaired in %s", (name) => {
    expect(unpairedCallIds(replay(name))).toEqual([]);
  });
});

describe("normalization to the Claude display vocabulary", () => {
  it("turns a file change into an Edit carrying file_path", () => {
    const edits = replay("recette-2-file-edit.jsonl").filter(
      (e) => e.type === "tool_use" && e.toolName === TOOL_LEXICON.EDIT,
    );
    expect(edits.length).toBeGreaterThan(0);
    const args = (edits[0] as { args: { file_path?: string } }).args;
    expect(typeof args.file_path).toBe("string");
  });

  it("turns a command execution into a Bash carrying command", () => {
    const commands = replay("q1b-readonly-command-no-write.jsonl").filter(
      (e) => e.type === "tool_use" && e.toolName === TOOL_LEXICON.BASH,
    );
    expect(commands.length).toBeGreaterThan(0);
    const args = (commands[0] as { args: { command?: string } }).args;
    expect(typeof args.command).toBe("string");
  });

  it("emits no tool_use for userMessage, reasoning or agentMessage", () => {
    const names = new Set(
      replay("recette-1-simple-message.jsonl")
        .filter((e) => e.type === "tool_use")
        .map((e) => (e as { toolName: string }).toolName),
    );
    expect(names).toEqual(new Set());
  });

  it("streams assistant deltas and a final assistant text", () => {
    const events = replay("recette-1-simple-message.jsonl");
    expect(events.some((e) => e.type === "assistant_text_delta")).toBe(true);
    expect(events.some((e) => e.type === "assistant_text")).toBe(true);
  });

  it("marks a declined file change as an errored result", () => {
    const results = replay("q1-readonly-write-escalation.jsonl").filter(
      (e) => e.type === "tool_result",
    );
    expect(results.some((e) => (e as { isError: boolean }).isError)).toBe(true);
  });
});

describe("turn completion", () => {
  it("ends a nominal turn with done, never error", () => {
    const events = replay("recette-1-simple-message.jsonl");
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("ends an interrupted turn with done and closes the orphan item", () => {
    const events = replay("q2-interrupt-mid-tool.jsonl");
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.some((e) => e.type === "error")).toBe(false);
    // The interrupted command never received an item/completed of its own.
    expect(unpairedCallIds(events)).toEqual([]);
    expect(events.some((e) => e.type === "tool_use")).toBe(true);
  });

  it("produces no TodoWrite, because Codex emits no plan events", () => {
    const events = replay("recette-plan-todo.jsonl");
    const todos = events.filter(
      (e) => e.type === "tool_use" && e.toolName === TOOL_LEXICON.TODO_WRITE,
    );
    expect(todos).toEqual([]);
  });
});

describe("synthesized events", () => {
  const adapter = createCodexAdapter();

  it("pairs a plan update with its result back to back", () => {
    const events = adapter.handle({
      method: "turn/plan/updated",
      params: {
        plan: [
          { step: "first", status: "inProgress" },
          { step: "second", status: "pending" },
        ],
      },
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("tool_use");
    expect(events[1]?.type).toBe("tool_result");
    const args = (events[0] as { args: { todos: { status: string }[] } }).args;
    expect(args.todos.map((t) => t.status)).toEqual(["in_progress", "pending"]);
  });

  it("qualifies an MCP tool call the way the Claude path names it", () => {
    const fresh = createCodexAdapter();
    const events = fresh.handle({
      method: "item/started",
      params: {
        item: {
          type: "mcpToolCall",
          id: "call_1",
          tool: "BuilderCatalog",
          status: "inProgress",
          arguments: {},
          result: null,
          error: null,
        },
      },
    });
    expect((events[0] as { toolName: string }).toolName).toBe(
      `${MCP_TOOL_NAME_PREFIX}BuilderCatalog`,
    );
  });

  it("reports a failed turn with the error message, not the error code", () => {
    const fresh = createCodexAdapter();
    const events = fresh.handle({
      method: "turn/completed",
      params: {
        turn: {
          status: "failed",
          error: { message: "stream disconnected", codexErrorInfo: "other" },
        },
      },
    });
    // `done` has to follow: the session ends a turn on `done` alone, so an
    // error on its own would leave the turn running forever.
    expect(events).toEqual([
      { type: "error", message: "stream disconnected" },
      { type: "done" },
    ]);
  });
});
