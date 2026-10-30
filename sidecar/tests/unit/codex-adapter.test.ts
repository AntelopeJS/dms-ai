import { describe, expect, it } from "vitest";
import type {
  RunnerEvent,
  RunnerToolResult,
  RunnerToolUse,
} from "../../src/agent/runner-events.js";
import { MCP_TOOL_NAME_PREFIX } from "../../src/constants/mcp.js";
import { TOOL_LEXICON } from "../../src/constants/tool-lexicon.js";
import { createCodexAdapter } from "../../src/providers/codex/adapter.js";
import { readNotifications } from "../helpers/codex-dumps.js";

function replay(name: string): RunnerEvent[] {
  const adapter = createCodexAdapter();
  return readNotifications(name).flatMap((n) => adapter.handle(n));
}

function toolUses(events: RunnerEvent[]): RunnerToolUse[] {
  return events.filter((e): e is RunnerToolUse => e.type === "tool_use");
}

function toolResults(events: RunnerEvent[]): RunnerToolResult[] {
  return events.filter((e): e is RunnerToolResult => e.type === "tool_result");
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
    const edits = toolUses(replay("recette-2-file-edit.jsonl")).filter(
      (e) => e.toolName === TOOL_LEXICON.EDIT,
    );
    expect(edits.length).toBeGreaterThan(0);
    expect(edits[0]?.args).toHaveProperty("file_path", expect.any(String));
  });

  it("turns a command execution into a Bash carrying command", () => {
    const commands = toolUses(
      replay("q1b-readonly-command-no-write.jsonl"),
    ).filter((e) => e.toolName === TOOL_LEXICON.BASH);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands[0]?.args).toHaveProperty("command", expect.any(String));
  });

  it("emits no tool_use for userMessage, reasoning or agentMessage", () => {
    const names = new Set(
      toolUses(replay("recette-1-simple-message.jsonl")).map((e) => e.toolName),
    );
    expect(names).toEqual(new Set());
  });

  it("streams assistant deltas and a final assistant text", () => {
    const events = replay("recette-1-simple-message.jsonl");
    expect(events.some((e) => e.type === "assistant_text_delta")).toBe(true);
    expect(events.some((e) => e.type === "assistant_text")).toBe(true);
  });

  it("marks a declined file change as an errored result", () => {
    const results = toolResults(replay("q1-readonly-write-escalation.jsonl"));
    expect(results.some((e) => e.isError)).toBe(true);
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
    expect(events[0]).toMatchObject({
      args: { todos: [{ status: "in_progress" }, { status: "pending" }] },
    });
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
    expect(events[0]).toMatchObject({
      toolName: `${MCP_TOOL_NAME_PREFIX}BuilderCatalog`,
    });
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
    expect(events).toEqual([
      { type: "error", message: "stream disconnected" },
      { type: "done" },
    ]);
  });
});

describe("activity with nothing to show yet", () => {
  it("reports reasoning and command output as activity, not as tools", () => {
    const fresh = createCodexAdapter();
    const reasoning = fresh.handle({
      method: "item/reasoning/summaryTextDelta",
      params: { itemId: "item-r", delta: "Reading the mockup" },
    });
    const output = fresh.handle({
      method: "item/commandExecution/outputDelta",
      params: { itemId: "item-c", delta: "installing" },
    });
    expect(reasoning).toEqual([{ type: "activity", kind: "thinking" }]);
    expect(output).toEqual([{ type: "activity", kind: "tool" }]);
  });

  it("reads a reconnecting error as a retry, never as the end of the turn", () => {
    const fresh = createCodexAdapter();
    const events = fresh.handle({
      method: "error",
      params: { message: "stream disconnected before completion" },
    });
    expect(events).toEqual([{ type: "activity", kind: "retrying" }]);
  });

  it("finds reasoning activity in a recorded turn", () => {
    const kinds = replay("recette-1-simple-message.jsonl")
      .filter((event) => event.type === "activity")
      .map((event) => (event.type === "activity" ? event.kind : null));
    expect(kinds).toContain("thinking");
  });
});
