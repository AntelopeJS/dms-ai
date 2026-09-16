import { randomUUID } from "node:crypto";
import {
  QUESTION_LOG_PREFIX,
  QUESTION_TIMEOUT_MS,
  QUESTION_TIMEOUT_REASON,
  QUESTION_UNKNOWN_REQUEST_REASON,
} from "../constants/questions.js";
import type { QuestionType } from "../protocol/events.js";

// The user's selected answers, aligned by index with the questions that were
// asked. `null` means the question was never answered (timeout or cancellation),
// letting the caller surface a "no answer" result instead of hanging forever.
export type QuestionAnswers = string[] | null;

export interface QuestionRequest {
  conversationId: string;
  questions: QuestionType[];
}

// The payload handed to the iframe when a question needs answering. Carries the
// requestId so the eventual QUESTION_RESPONSE can be matched back.
export interface PendingQuestion {
  requestId: string;
  conversationId: string;
  questions: QuestionType[];
}

export interface QuestionBusOptions {
  onPromptIframe: (event: PendingQuestion) => void;
  timeoutMs?: number;
}

export interface QuestionBus {
  requestQuestion: (req: QuestionRequest) => Promise<QuestionAnswers>;
  resolveQuestion: (requestId: string, answers: string[]) => void;
  getPendingForConversation: (conversationId: string) => PendingQuestion[];
  // Resolve every pending question for a conversation as unanswered (turn
  // interrupted or conversation deleted) so the awaiting tools settle.
  cancelConversation: (conversationId: string) => void;
}

interface PendingState {
  requestId: string;
  conversationId: string;
  questions: QuestionType[];
  resolve: (answers: QuestionAnswers) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface BusState {
  pending: Map<string, PendingState>;
  timeoutMs: number;
  onPromptIframe: (event: PendingQuestion) => void;
}

function pendingToQuestion(pending: PendingState): PendingQuestion {
  return {
    requestId: pending.requestId,
    conversationId: pending.conversationId,
    questions: pending.questions,
  };
}

function settlePending(
  state: BusState,
  pending: PendingState,
  answers: QuestionAnswers,
): void {
  clearTimeout(pending.timer);
  state.pending.delete(pending.requestId);
  pending.resolve(answers);
}

function scheduleTimeout(
  state: BusState,
  requestId: string,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    const pending = state.pending.get(requestId);
    if (!pending) return;
    console.warn(
      `${QUESTION_LOG_PREFIX} ${QUESTION_TIMEOUT_REASON} (requestId=${requestId})`,
    );
    settlePending(state, pending, null);
  }, state.timeoutMs);
}

function registerPending(
  state: BusState,
  req: QuestionRequest,
  resolve: (answers: QuestionAnswers) => void,
): PendingQuestion {
  const requestId = randomUUID();
  const timer = scheduleTimeout(state, requestId);
  const pending: PendingState = {
    requestId,
    conversationId: req.conversationId,
    questions: req.questions,
    resolve,
    timer,
  };
  state.pending.set(requestId, pending);
  return pendingToQuestion(pending);
}

function startRequest(
  state: BusState,
  req: QuestionRequest,
): Promise<QuestionAnswers> {
  return new Promise<QuestionAnswers>((resolve) => {
    const event = registerPending(state, req, resolve);
    state.onPromptIframe(event);
  });
}

function handleResolve(
  state: BusState,
  requestId: string,
  answers: string[],
): void {
  const pending = state.pending.get(requestId);
  if (!pending) {
    console.warn(
      `${QUESTION_LOG_PREFIX} ${QUESTION_UNKNOWN_REQUEST_REASON} (requestId=${requestId})`,
    );
    return;
  }
  settlePending(state, pending, answers);
}

function collectPendingForConversation(
  state: BusState,
  conversationId: string,
): PendingQuestion[] {
  const out: PendingQuestion[] = [];
  for (const pending of state.pending.values()) {
    if (pending.conversationId !== conversationId) continue;
    out.push(pendingToQuestion(pending));
  }
  return out;
}

function cancelConversation(state: BusState, conversationId: string): void {
  // Snapshot: settlePending deletes from the map being iterated.
  // oxlint-disable-next-line unicorn/no-useless-spread
  for (const pending of [...state.pending.values()]) {
    if (pending.conversationId !== conversationId) continue;
    settlePending(state, pending, null);
  }
}

function buildState(opts: QuestionBusOptions): BusState {
  return {
    pending: new Map(),
    timeoutMs: opts.timeoutMs ?? QUESTION_TIMEOUT_MS,
    onPromptIframe: opts.onPromptIframe,
  };
}

export function createQuestionBus(opts: QuestionBusOptions): QuestionBus {
  const state = buildState(opts);
  return {
    requestQuestion(req) {
      return startRequest(state, req);
    },
    resolveQuestion(requestId, answers) {
      handleResolve(state, requestId, answers);
    },
    getPendingForConversation(conversationId) {
      return collectPendingForConversation(state, conversationId);
    },
    cancelConversation(conversationId) {
      cancelConversation(state, conversationId);
    },
  };
}
