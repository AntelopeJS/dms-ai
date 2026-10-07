import { randomUUID } from "node:crypto";
import type { AllowedBy } from "../constants/audit.js";
import {
  PERMISSION_DECISIONS,
  PERMISSION_DENIED_MESSAGE,
  PERMISSION_DENY_ALL_MESSAGE,
  PERMISSION_EXPIRED_MESSAGE,
  PERMISSION_FEEDBACK_PREFIX,
  PERMISSION_LOG_PREFIX,
  PERMISSION_SETTLEMENTS,
  PERMISSION_TIMEOUT_REASON,
  PERMISSION_UNKNOWN_REQUEST_REASON,
} from "../constants/permissions.js";
import type {
  ActiveRuleType,
  PermissionRequestEventType,
} from "../protocol/events.js";
import type {
  PermissionDecisionValue,
  PermissionRuleType,
} from "../protocol/messages.js";
import { describeRequest } from "./permission-preview.js";
import {
  createPermissionRuleStore,
  isSameRule,
  type PermissionRuleStore,
} from "./permission-rules.js";
import { buildToolSummary } from "./tool-summary.js";

export interface PermissionRequest {
  conversationId: string;
  toolName: string;
  args: unknown;
  // The provider's id for the call, when it gives one.
  callId?: string;
}

/** What the agent is told, and what the audit records, for one request. */
export interface PermissionOutcome {
  isAllowed: boolean;
  allowedBy: AllowedBy;
  feedback?: string;
  keepData?: boolean;
  // deny_all: the turn is to be stopped as well.
  shouldInterrupt?: boolean;
}

/** A request waiting for the user, exactly as the chat is shown it. */
export type PendingRequest = Omit<PermissionRequestEventType, "type">;

export type PermissionSettlementKind =
  | PermissionDecisionValue
  | (typeof PERMISSION_SETTLEMENTS)[keyof typeof PERMISSION_SETTLEMENTS];

/** How the bus judges one conversation's requests right now. */
export interface PermissionPolicy {
  hostProjectRoot: string;
  // Full auto in force (and not capped by safe mode).
  isFullAuto: boolean;
  timeoutMs: number;
  alwaysAskDependencies: boolean;
  alwaysAskBlockRemoval: boolean;
}

/** Every decision the bus makes, prompted or not. */
export interface PermissionDecisionRecord {
  conversationId: string;
  callId?: string;
  toolName: string;
  outcome: PermissionOutcome;
  // Set when the user was asked: the request and how it ended.
  prompt?: PermissionPrompt;
}

export interface PermissionPrompt {
  request: PendingRequest;
  settledAs: PermissionSettlementKind;
  decidedAtMs: number;
  decidedBy?: string;
}

/** The user's answer to one request. */
export interface PermissionAnswer {
  requestId: string;
  decision: PermissionDecisionValue;
  rule?: PermissionRuleType;
  feedback?: string;
  keepData?: boolean;
  actor?: string;
}

export interface BusOptions {
  getPolicy: (conversationId: string) => PermissionPolicy;
  onPromptChat: (event: PendingRequest) => void;
  onDecided?: (record: PermissionDecisionRecord) => void;
  onRulesChanged?: (conversationId: string, rules: ActiveRuleType[]) => void;
  onDenyAll?: (conversationId: string) => void;
  // Overrides the policy's timeout (tests).
  timeoutMs?: number;
  rules?: PermissionRuleStore;
}

export interface PermissionBus {
  requestPermission(req: PermissionRequest): Promise<PermissionOutcome>;
  resolvePermission(answer: PermissionAnswer): void;
  getPendingForConversation(conversationId: string): PendingRequest[];
  countPending(conversationId?: string): number;
  /** Denies everything pending for the conversation (turn interrupted). */
  cancelConversation(conversationId: string): void;
  /** Cancels what is pending and drops the conversation's rules. */
  forgetConversation(conversationId: string): void;
  listRules(conversationId: string): ActiveRuleType[];
  revokeRule(conversationId: string, ruleId: string): boolean;
}

interface PendingState {
  request: PendingRequest;
  resolve: (outcome: PermissionOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface BusState extends BusOptions {
  pending: Map<string, PendingState>;
  rules: PermissionRuleStore;
}

const DENIED: PermissionOutcome = { isAllowed: false, allowedBy: "denied" };

/** The reason the agent reads when a request is refused. */
export function denialMessage(outcome: PermissionOutcome): string {
  if (outcome.allowedBy === "expired") return PERMISSION_EXPIRED_MESSAGE;
  if (outcome.shouldInterrupt === true) return PERMISSION_DENY_ALL_MESSAGE;
  const feedback = outcome.feedback?.trim();
  if (feedback) return `${PERMISSION_FEEDBACK_PREFIX}${feedback}`;
  return PERMISSION_DENIED_MESSAGE;
}

function settle(
  state: BusState,
  pending: PendingState,
  outcome: PermissionOutcome,
  answer: Omit<PermissionPrompt, "request" | "decidedAtMs">,
): void {
  clearTimeout(pending.timer);
  state.pending.delete(pending.request.requestId);
  const { request } = pending;
  state.onDecided?.({
    conversationId: request.conversationId,
    callId: request.callId,
    toolName: request.toolName,
    outcome,
    prompt: { request, decidedAtMs: Date.now(), ...answer },
  });
  pending.resolve(outcome);
}

function addRule(
  state: BusState,
  pending: PendingState,
  rule: PermissionRuleType | undefined,
): void {
  const offered = pending.request.ruleOptions;
  if (rule === undefined || !offered.some((o) => isSameRule(o, rule))) return;
  const { conversationId } = pending.request;
  state.rules.add(conversationId, rule);
  state.onRulesChanged?.(conversationId, state.rules.list(conversationId));
}

function pendingOf(state: BusState, conversationId: string): PendingState[] {
  return [...state.pending.values()].filter(
    (p) => p.request.conversationId === conversationId,
  );
}

function denyAll(
  state: BusState,
  pending: PendingState,
  answer: PermissionAnswer,
): void {
  const outcome: PermissionOutcome = { ...DENIED, shouldInterrupt: true };
  const { conversationId } = pending.request;
  for (const other of [pending, ...pendingOf(state, conversationId)]) {
    if (!state.pending.has(other.request.requestId)) continue;
    settle(state, other, outcome, {
      settledAs: PERMISSION_DECISIONS.DENY_ALL,
      decidedBy: answer.actor,
    });
  }
  state.onDenyAll?.(conversationId);
}

type AnswerHandler = (
  state: BusState,
  pending: PendingState,
  answer: PermissionAnswer,
) => void;

const ANSWER_HANDLERS: Record<PermissionDecisionValue, AnswerHandler> = {
  allow_once: (state, pending, answer) =>
    settle(
      state,
      pending,
      { isAllowed: true, allowedBy: "approved", keepData: answer.keepData },
      { settledAs: answer.decision, decidedBy: answer.actor },
    ),
  allow_rule: (state, pending, answer) => {
    addRule(state, pending, answer.rule);
    settle(
      state,
      pending,
      { isAllowed: true, allowedBy: "approved" },
      { settledAs: answer.decision, decidedBy: answer.actor },
    );
  },
  deny: (state, pending, answer) =>
    settle(
      state,
      pending,
      { ...DENIED, feedback: answer.feedback },
      { settledAs: answer.decision, decidedBy: answer.actor },
    ),
  deny_all: denyAll,
};

function scheduleTimeout(
  state: BusState,
  requestId: string,
  timeoutMs: number,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    const pending = state.pending.get(requestId);
    if (pending === undefined) return;
    console.warn(
      `${PERMISSION_LOG_PREFIX} ${PERMISSION_TIMEOUT_REASON} (requestId=${requestId})`,
    );
    settle(
      state,
      pending,
      { isAllowed: false, allowedBy: "expired" },
      { settledAs: PERMISSION_SETTLEMENTS.EXPIRED },
    );
  }, timeoutMs);
}

async function buildPending(
  req: PermissionRequest,
  policy: PermissionPolicy,
  timeoutMs: number,
): Promise<PendingRequest> {
  const description = await describeRequest({
    toolName: req.toolName,
    args: req.args,
    hostProjectRoot: policy.hostProjectRoot,
    alwaysAskDependencies: policy.alwaysAskDependencies,
    alwaysAskBlockRemoval: policy.alwaysAskBlockRemoval,
  });
  const createdAtMs = Date.now();
  return {
    conversationId: req.conversationId,
    requestId: randomUUID(),
    callId: req.callId,
    toolName: req.toolName,
    args: req.args,
    summary: buildToolSummary(req.toolName, req.args),
    ...description,
    createdAtMs,
    expiresAtMs: createdAtMs + timeoutMs,
  };
}

function decideWithoutAsking(
  state: BusState,
  req: PermissionRequest,
  request: PendingRequest,
  policy: PermissionPolicy,
): PermissionOutcome | null {
  if (request.alwaysAsk) return null;
  const subject = { ...req, hostProjectRoot: policy.hostProjectRoot };
  if (state.rules.matches(req.conversationId, subject)) {
    return { isAllowed: true, allowedBy: "rule" };
  }
  if (policy.isFullAuto) return { isAllowed: true, allowedBy: "full_auto" };
  return null;
}

async function startRequest(
  state: BusState,
  req: PermissionRequest,
): Promise<PermissionOutcome> {
  const policy = state.getPolicy(req.conversationId);
  const timeoutMs = state.timeoutMs ?? policy.timeoutMs;
  const request = await buildPending(req, policy, timeoutMs);
  const automatic = decideWithoutAsking(state, req, request, policy);
  if (automatic !== null) {
    state.onDecided?.({ ...req, outcome: automatic });
    return automatic;
  }
  return new Promise<PermissionOutcome>((resolve) => {
    const timer = scheduleTimeout(state, request.requestId, timeoutMs);
    state.pending.set(request.requestId, { request, resolve, timer });
    state.onPromptChat(request);
  });
}

function handleAnswer(state: BusState, answer: PermissionAnswer): void {
  const pending = state.pending.get(answer.requestId);
  if (pending === undefined) {
    console.warn(
      `${PERMISSION_LOG_PREFIX} ${PERMISSION_UNKNOWN_REQUEST_REASON} (requestId=${answer.requestId})`,
    );
    return;
  }
  ANSWER_HANDLERS[answer.decision](state, pending, answer);
}

function cancelConversation(state: BusState, conversationId: string): void {
  for (const pending of pendingOf(state, conversationId)) {
    settle(state, pending, DENIED, {
      settledAs: PERMISSION_SETTLEMENTS.CANCELLED,
    });
  }
}

export function createPermissionBus(opts: BusOptions): PermissionBus {
  const state: BusState = {
    ...opts,
    pending: new Map(),
    rules: opts.rules ?? createPermissionRuleStore(),
  };
  return {
    requestPermission: (req) => startRequest(state, req),
    resolvePermission: (answer) => handleAnswer(state, answer),
    getPendingForConversation: (conversationId) =>
      pendingOf(state, conversationId).map((p) => p.request),
    countPending: (conversationId) =>
      conversationId === undefined
        ? state.pending.size
        : pendingOf(state, conversationId).length,
    cancelConversation: (conversationId) =>
      cancelConversation(state, conversationId),
    forgetConversation(conversationId) {
      cancelConversation(state, conversationId);
      state.rules.forget(conversationId);
    },
    listRules: (conversationId) => state.rules.list(conversationId),
    revokeRule(conversationId, ruleId) {
      const isRevoked = state.rules.revoke(conversationId, ruleId);
      if (isRevoked) {
        state.onRulesChanged?.(
          conversationId,
          state.rules.list(conversationId),
        );
      }
      return isRevoked;
    },
  };
}
