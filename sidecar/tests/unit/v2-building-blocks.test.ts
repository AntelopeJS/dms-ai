import { describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";
import { createCallLedger } from "../../src/agent/call-ledger.js";
import { ASK_USER_RESULT_SKIPPED } from "../../src/constants/mcp.js";
import type { AnyMcpToolDefinition } from "../../src/mcp/define-tool.js";
import { gateBuilderTools } from "../../src/mcp/tools/builder-gate.js";
import { buildBuilderTools } from "../../src/mcp/tools/builder.js";
import { buildAskUserTool } from "../../src/mcp/tools/ask-user.js";
import { createChatSocketRegistry } from "../../src/server/chat-socket-registry.js";
import { createPendingQueueStore } from "../../src/server/pending-queue.js";
import { inspectBuild } from "../../src/server/safety-net.js";

const CONVERSATION_ID = "conv-blocks";

function fakeSocket() {
  const sent: string[] = [];
  return {
    socket: { send: (raw: string) => sent.push(raw) } as unknown as WebSocket,
    sent,
  };
}

describe("Builder gate", () => {
  const builderClient = { call: vi.fn(async () => ({ ok: true })) };

  function tool(name: string, gate: Parameters<typeof gateBuilderTools>[1]) {
    const tools: AnyMcpToolDefinition[] = buildBuilderTools({
      builderClient,
      gate,
    });
    return tools.find((t) => t.name === name);
  }

  it("refuses a denied deletion with the reason, without calling the Builder", async () => {
    builderClient.call.mockClear();
    const deletePage = tool("BuilderDeletePage", async () => ({
      isAllowed: false,
      message: "no",
    }));
    const result = await deletePage?.handler({ pageRef: "/p" }, {});
    expect(result).toMatchObject({ isError: true, content: [{ text: "no" }] });
    expect(builderClient.call).not.toHaveBeenCalled();
  });

  it("deletes the resource's code only when the user keeps the data", async () => {
    builderClient.call.mockClear();
    const remove = tool("BuilderDeleteResource", async () => ({
      isAllowed: true,
      keepData: true,
    }));
    await remove?.handler({ ref: "books" }, {});
    expect(builderClient.call).toHaveBeenCalledWith("DeleteResource", [
      "books",
      { keepData: true },
    ]);
  });

  it("never gates a read tool", async () => {
    const gate = vi.fn(async () => ({ isAllowed: false }));
    await tool("BuilderCatalog", gate)?.handler({}, {});
    expect(gate).not.toHaveBeenCalled();
  });
});

describe("call ledger", () => {
  it("pairs a handler with the call the provider announced", () => {
    const ledger = createCallLedger();
    ledger.announce(
      CONVERSATION_ID,
      "toolu_1",
      "mcp__dms-ai__BuilderDeletePage",
      { pageRef: "/a" },
    );
    ledger.announce(
      CONVERSATION_ID,
      "toolu_2",
      "mcp__dms-ai__BuilderDeletePage",
      { pageRef: "/b" },
    );
    expect(
      ledger.claim(CONVERSATION_ID, "BuilderDeletePage", { pageRef: "/b" }),
    ).toBe("toolu_2");
    expect(
      ledger.claim(CONVERSATION_ID, "BuilderDeletePage", { pageRef: "/zzz" }),
    ).toBe("toolu_1");
    expect(
      ledger.claim(CONVERSATION_ID, "BuilderDeletePage", {}),
    ).toBeUndefined();
  });
});

describe("pending queue", () => {
  it("rewrites and moves a follow-up", () => {
    const queue = createPendingQueueStore();
    for (const id of ["a", "b", "c"])
      queue.enqueue(CONVERSATION_ID, { id, content: id });
    expect(queue.update(CONVERSATION_ID, "b", "B")).toBe(true);
    expect(queue.move(CONVERSATION_ID, "a", 99)).toBe(true);
    expect(queue.get(CONVERSATION_ID).map((i) => i.content)).toEqual([
      "B",
      "c",
      "a",
    ]);
    expect(queue.update(CONVERSATION_ID, "gone", "x")).toBe(false);
    expect(queue.move(CONVERSATION_ID, "gone", 0)).toBe(false);
  });
});

describe("chat sockets", () => {
  it("reaches every tab on a conversation, and broadcasts to all chats", () => {
    const registry = createChatSocketRegistry();
    const one = fakeSocket();
    const two = fakeSocket();
    const idle = fakeSocket();
    registry.set(CONVERSATION_ID, one.socket);
    registry.set(CONVERSATION_ID, two.socket);
    registry.addChat(idle.socket);
    registry.send(CONVERSATION_ID, {
      type: "run_done",
      conversationId: CONVERSATION_ID,
    });
    expect([one.sent.length, two.sent.length, idle.sent.length]).toEqual([
      1, 1, 0,
    ]);
    registry.broadcast({ type: "conversation_list", conversations: [] });
    expect(idle.sent).toHaveLength(1);
    expect(registry.socketOf(CONVERSATION_ID)).toBe(two.socket);
    registry.clear(two.socket);
    expect(registry.socketOf(CONVERSATION_ID)).toBe(one.socket);
  });
});

describe("AskUser", () => {
  it("tells the agent to decide a skipped question", async () => {
    const askUser = buildAskUserTool({
      conversationId: CONVERSATION_ID,
      requestQuestion: async () => ({
        answers: ["", "Blue"],
        skipped: [true, false],
      }),
    });
    const questions = ["Size", "Color"].map((header) => ({
      header,
      question: `${header}?`,
      options: [
        { label: "A", description: "" },
        { label: "B", description: "" },
      ],
    }));
    const result = await askUser.handler({ questions }, {});
    expect(result.content[0]?.text).toContain(
      `- Size: ${ASK_USER_RESULT_SKIPPED}`,
    );
    expect(result.content[0]?.text).toContain("- Color: Blue");
  });
});

describe("safety net report", () => {
  const base = {
    editedFiles: ["/proj/src/a.ts"],
    knownRoots: ["/proj"],
    sinceMs: 0,
    delay: async () => {},
    logsClient: { getLogs: async () => [] },
  };

  it("reports a passing typecheck without a heal prompt", async () => {
    const report = await inspectBuild({
      ...base,
      runTypecheckFn: async () => ({
        ran: true,
        ok: true,
        errorCount: 0,
        summary: "No type errors.",
      }),
    });
    expect(report).toEqual({
      healPrompt: null,
      typecheck: "passed",
      errors: [],
    });
  });

  it("lists the errors for the auto-fix notice", async () => {
    const report = await inspectBuild({
      ...base,
      runTypecheckFn: async () => ({
        ran: true,
        ok: false,
        errorCount: 1,
        summary: "Type errors found:\nsrc/a.ts(1,2): error TS2322: nope",
      }),
    });
    expect(report.typecheck).toBe("failed");
    expect(report.errors).toContain("src/a.ts(1,2): error TS2322: nope");
    expect(report.healPrompt).not.toBeNull();
  });

  it("reports skipped when no typecheck could run", async () => {
    const report = await inspectBuild({
      ...base,
      runTypecheckFn: async () => ({
        ran: false,
        ok: true,
        errorCount: 0,
        summary: "",
      }),
    });
    expect(report.typecheck).toBe("skipped");
  });
});
