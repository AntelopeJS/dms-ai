import { randomUUID } from "node:crypto";
import {
  QUESTION_LOG_PREFIX,
  QUESTION_TIMEOUT_MS,
  QUESTION_TIMEOUT_REASON,
  QUESTION_UNKNOWN_REQUEST_REASON,
} from "../constants/questions.js";
import type { QuestionType } from "../protocol/events.js";

/**
 * The user's selected answers, aligned by index with the questions that were
 * asked; `skipped[i]` marks a question left to the agent ("Skip, you decide"),
 * whose answer is then ignored.
 */
export interface QuestionReply {
  answers: string[];
  skipped: boolean[];
}

// `null` means the question was never answered (timeout or cancellation),
// letting the caller surface a "no answer" result instead of hanging forever.
export type QuestionAnswers = QuestionReply | null;

export interface QuestionRequest {
  conversationId: string;
  questions: QuestionType[];
}

// The payload handed to the chat when a question needs answering. Carries the
// requestId so the eventual QUESTION_RESPONSE can be matched back.
export interface PendingQuestion {
  requestId: string;
  conversationId: string;
  questions: QuestionType[];
  createdAtMs: number;
  expiresAtMs: number;
}

export interface QuestionBusOptions {
  onPromptChat: (event: PendingQuestion) => void;
  // A question answered (or skipped): the reply, for the transcript.
  onAnswered?: (event: PendingQuestion, reply: QuestionReply) => void;
  onExpired?: (event: PendingQuestion) => void;
  // Any question settled, whatever the way: pending counts changed.
  onSettled?: (event: PendingQuestion) => void;
  timeoutMs?: number;
}

export interface QuestionBus {
  requestQuestion: (req: QuestionRequest) => Promise<QuestionAnswers>;
  resolveQuestion: (requestId: string, reply: QuestionReply) => void;
  countPending: (conversationId?: string) => number;
  getPendingForConversation: (conversationId: string) => PendingQuestion[];
  // Resolve every pending question for a conversation as unanswered (turn
  // interrupted or conversation deleted) so the awaiting tools settle.
  cancelConversation: (conversationId: string) => void;
}

interface PendingState extends PendingQuestion {
  resolve: (answers: QuestionAnswers) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface BusState extends QuestionBusOptions {
  pending: Map<string, PendingState>;
  timeoutMs: number;
}

function pendingToQuestion(pending: PendingState): PendingQuestion {
  return {
    requestId: pending.requestId,
    conversationId: pending.conversationId,
    questions: pending.questions,
    createdAtMs: pending.createdAtMs,
    expiresAtMs: pending.expiresAtMs,
  };
}

function settlePending(
  state: BusState,
  pending: PendingState,
  answers: QuestionAnswers,
): void {
  clearTimeout(pending.timer);
  state.pending.delete(pending.requestId);
  state.onSettled?.(pendingToQuestion(pending));
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
    state.onExpired?.(pendingToQuestion(pending));
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
  const createdAtMs = Date.now();
  const pending: PendingState = {
    requestId,
    conversationId: req.conversationId,
    questions: req.questions,
    createdAtMs,
    expiresAtMs: createdAtMs + state.timeoutMs,
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
    state.onPromptChat(event);
  });
}

function handleResolve(
  state: BusState,
  requestId: string,
  reply: QuestionReply,
): void {
  const pending = state.pending.get(requestId);
  if (!pending) {
    console.warn(
      `${QUESTION_LOG_PREFIX} ${QUESTION_UNKNOWN_REQUEST_REASON} (requestId=${requestId})`,
    );
    return;
  }
  state.onAnswered?.(pendingToQuestion(pending), reply);
  settlePending(state, pending, reply);
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
    ...opts,
    pending: new Map(),
    timeoutMs: opts.timeoutMs ?? QUESTION_TIMEOUT_MS,
  };
}

export function createQuestionBus(opts: QuestionBusOptions): QuestionBus {
  const state = buildState(opts);
  return {
    requestQuestion(req) {
      return startRequest(state, req);
    },
    resolveQuestion(requestId, reply) {
      handleResolve(state, requestId, reply);
    },
    countPending(conversationId) {
      if (conversationId === undefined) return state.pending.size;
      return collectPendingForConversation(state, conversationId).length;
    },
    getPendingForConversation(conversationId) {
      return collectPendingForConversation(state, conversationId);
    },
    cancelConversation(conversationId) {
      cancelConversation(state, conversationId);
    },
  };
}
