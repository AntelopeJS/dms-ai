import { describe, expect, it, vi } from "vitest";
import {
  createQuestionBus,
  type PendingQuestion,
} from "../../src/agent/question-bus.js";
import type { QuestionType } from "../../src/protocol/events.js";

const CONVERSATION_ID = "conv-1";
const OTHER_CONVERSATION_ID = "conv-2";
const FAST_TIMEOUT_MS = 50;

const QUESTIONS: QuestionType[] = [
  {
    question: "Pick one?",
    header: "Choice",
    options: [
      { label: "A", description: "first" },
      { label: "B", description: "second" },
    ],
  },
];

interface Capture {
  prompts: PendingQuestion[];
}

function makeCapture(): Capture {
  return { prompts: [] };
}

function makeBus(capture: Capture, timeoutMs = FAST_TIMEOUT_MS) {
  return createQuestionBus({
    onPromptIframe: (event) => {
      capture.prompts.push(event);
    },
    timeoutMs,
  });
}

function buildRequest(conversationId = CONVERSATION_ID) {
  return { conversationId, questions: QUESTIONS };
}

async function settleNextTick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("question bus", () => {
  it("prompts the iframe and resolves with the submitted answers", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    const promise = bus.requestQuestion(buildRequest());
    await settleNextTick();
    expect(capture.prompts).toHaveLength(1);
    expect(capture.prompts[0]?.questions).toEqual(QUESTIONS);
    const requestId = capture.prompts[0]?.requestId as string;
    bus.resolveQuestion(requestId, ["A"]);
    await expect(promise).resolves.toEqual(["A"]);
  });

  it("resolves to null when no answer arrives before the timeout", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const answers = await bus.requestQuestion(buildRequest());
    expect(answers).toBeNull();
    warnSpy.mockRestore();
  });

  it("lists pending questions for a conversation", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    void bus.requestQuestion(buildRequest());
    await settleNextTick();
    const pending = bus.getPendingForConversation(CONVERSATION_ID);
    expect(pending).toHaveLength(1);
    expect(bus.getPendingForConversation(OTHER_CONVERSATION_ID)).toHaveLength(
      0,
    );
  });

  it("cancelConversation resolves pending questions as unanswered", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    const promise = bus.requestQuestion(buildRequest());
    await settleNextTick();
    bus.cancelConversation(CONVERSATION_ID);
    await expect(promise).resolves.toBeNull();
    expect(bus.getPendingForConversation(CONVERSATION_ID)).toHaveLength(0);
  });

  it("ignores a response for an unknown request id", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    bus.resolveQuestion("nope", ["A"]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
