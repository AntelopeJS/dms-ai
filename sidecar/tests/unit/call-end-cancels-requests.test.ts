import { describe, expect, it } from "vitest";
import { createQuestionBus } from "../../src/agent/question-bus.js";
import { EVENT_TYPES } from "../../src/protocol/events.js";
import type { SidecarServices } from "../../src/server/services.js";
import { handleTurnEvent } from "../../src/server/turns.js";
import { createTestBus } from "../helpers/permission-bus.js";

const CONVERSATION_ID = "conv-ended";
const LONG_TIMEOUT_MS = 10_000;
const QUESTIONS = [
  {
    question: "Ship it?",
    header: "Ship",
    options: [
      { label: "Yes", description: "now" },
      { label: "No", description: "later" },
    ],
  },
];

interface Harness {
  services: SidecarServices;
  sent: Array<Record<string, unknown>>;
}

function buildHarness(): Harness {
  const sent: Array<Record<string, unknown>> = [];
  const send = (_id: string, event: unknown) => {
    sent.push(event as Record<string, unknown>);
  };
  const questionBus = createQuestionBus({
    onPromptChat: () => {},
    onExpired: (question) =>
      send(question.conversationId, {
        type: EVENT_TYPES.QUESTION_EXPIRED,
        requestId: question.requestId,
      }),
    timeoutMs: LONG_TIMEOUT_MS,
  });
  const permissions = createTestBus({ timeoutMs: LONG_TIMEOUT_MS });
  const services = {
    questionBus,
    permissionBus: permissions.bus,
    turns: { get: () => undefined },
    conversationStore: {
      get: () => undefined,
      patchMessages: () => {},
      appendMessage: () => {},
    },
    callAudit: { lookup: () => undefined, record: () => {} },
    conversationModes: { isFullAuto: () => false },
    chatSocketRegistry: { send },
    liveTurns: { append: () => {}, end: () => {} },
    editTracker: { record: () => {} },
  } as unknown as SidecarServices;
  return { services, sent };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("a provider-side call end", () => {
  it("expires the question its AskUser call was waiting on", async () => {
    const { services, sent } = buildHarness();
    const answer = services.questionBus.requestQuestion({
      conversationId: CONVERSATION_ID,
      questions: QUESTIONS,
      callId: "call-ask",
    });
    await settle();
    handleTurnEvent(services, CONVERSATION_ID, {
      type: "tool_result",
      callId: "call-ask",
      result: 'MCP server "dms-ai" tool "AskUser" timed out after 60s',
      isError: true,
    });
    await expect(answer).resolves.toBeNull();
    expect(sent.map((e) => e.type)).toContain(EVENT_TYPES.QUESTION_EXPIRED);
  });

  it("settles the Builder permission its call was waiting on", async () => {
    const { services } = buildHarness();
    const outcome = services.permissionBus.requestPermission({
      conversationId: CONVERSATION_ID,
      toolName: "mcp__dms-ai__BuilderDeletePage",
      args: { pageRef: "/p" },
      callId: "call-delete",
    });
    await settle();
    handleTurnEvent(services, CONVERSATION_ID, {
      type: "tool_result",
      callId: "call-delete",
      result: "timed out",
      isError: true,
    });
    await expect(outcome).resolves.toMatchObject({ isAllowed: false });
    expect(services.permissionBus.countPending(CONVERSATION_ID)).toBe(0);
  });

  it("expires every question still open when the turn ends", async () => {
    const { services, sent } = buildHarness();
    const answer = services.questionBus.requestQuestion({
      conversationId: CONVERSATION_ID,
      questions: QUESTIONS,
    });
    await settle();
    handleTurnEvent(services, CONVERSATION_ID, { type: "done" });
    await expect(answer).resolves.toBeNull();
    expect(sent.map((e) => e.type)).toContain(EVENT_TYPES.QUESTION_EXPIRED);
  });
});
