import { randomUUID } from "node:crypto";
import {
  PERMISSION_DECISIONS,
  PERMISSION_LOG_PREFIX,
  PERMISSION_TIMEOUT_MS,
  PERMISSION_TIMEOUT_REASON,
  PERMISSION_UNKNOWN_REQUEST_REASON,
  type PermissionDecision,
} from "../constants/permissions.js";

export interface PermissionRequest {
  conversationId: string;
  toolName: string;
  args: unknown;
}

export interface PendingRequest {
  requestId: string;
  conversationId: string;
  toolName: string;
  args: unknown;
}

export interface BusOptions {
  onPromptIframe: (event: PendingRequest) => void;
  timeoutMs?: number;
}

export interface PermissionBus {
  requestPermission(req: PermissionRequest): Promise<PermissionDecision>;
  resolvePermission(requestId: string, decision: PermissionDecision): void;
  rememberSessionDecision(conversationId: string, toolName: string): void;
  hasSessionAllowed(conversationId: string, toolName: string): boolean;
  forgetConversation(conversationId: string): void;
  getPendingForConversation(conversationId: string): PendingRequest[];
  setAutoApprove(autoApprove: boolean): void;
}

interface PendingState {
  requestId: string;
  conversationId: string;
  toolName: string;
  args: unknown;
  resolve: (decision: PermissionDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface BusState {
  pending: Map<string, PendingState>;
  sessionAllowed: Map<string, Set<string>>;
  timeoutMs: number;
  autoApprove: boolean;
  onPromptIframe: (event: PendingRequest) => void;
}

function ensureSessionSet(
  state: BusState,
  conversationId: string,
): Set<string> {
  const existing = state.sessionAllowed.get(conversationId);
  if (existing) return existing;
  const fresh = new Set<string>();
  state.sessionAllowed.set(conversationId, fresh);
  return fresh;
}

// "Allow for session" grants the TOOL for the rest of the conversation, not just
// this exact call — keying on args would re-prompt on every different file/config.
function rememberDecision(
  state: BusState,
  conversationId: string,
  toolName: string,
): void {
  const set = ensureSessionSet(state, conversationId);
  set.add(toolName);
}

function hasAllowed(
  state: BusState,
  conversationId: string,
  toolName: string,
): boolean {
  const set = state.sessionAllowed.get(conversationId);
  if (!set) return false;
  return set.has(toolName);
}

type DecisionHandler = (state: BusState, pending: PendingState) => void;

const DECISION_HANDLERS: Record<PermissionDecision, DecisionHandler> = {
  [PERMISSION_DECISIONS.ALLOW_ONCE]: () => {},
  [PERMISSION_DECISIONS.ALLOW_SESSION]: (state, pending) => {
    rememberDecision(state, pending.conversationId, pending.toolName);
  },
  [PERMISSION_DECISIONS.DENY]: () => {},
};

function applyDecisionSideEffect(
  state: BusState,
  pending: PendingState,
  decision: PermissionDecision,
): void {
  const handler = DECISION_HANDLERS[decision];
  handler(state, pending);
}

function settlePending(
  state: BusState,
  pending: PendingState,
  decision: PermissionDecision,
): void {
  clearTimeout(pending.timer);
  state.pending.delete(pending.requestId);
  applyDecisionSideEffect(state, pending, decision);
  pending.resolve(decision);
}

function scheduleTimeout(
  state: BusState,
  requestId: string,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    const pending = state.pending.get(requestId);
    if (!pending) return;
    console.warn(
      `${PERMISSION_LOG_PREFIX} ${PERMISSION_TIMEOUT_REASON} (requestId=${requestId})`,
    );
    settlePending(state, pending, PERMISSION_DECISIONS.DENY);
  }, state.timeoutMs);
}

function registerPending(
  state: BusState,
  req: PermissionRequest,
  resolve: (decision: PermissionDecision) => void,
): PendingRequest {
  const requestId = randomUUID();
  const timer = scheduleTimeout(state, requestId);
  const pending: PendingState = {
    requestId,
    conversationId: req.conversationId,
    toolName: req.toolName,
    args: req.args,
    resolve,
    timer,
  };
  state.pending.set(requestId, pending);
  return {
    requestId,
    conversationId: req.conversationId,
    toolName: req.toolName,
    args: req.args,
  };
}

function startRequest(
  state: BusState,
  req: PermissionRequest,
): Promise<PermissionDecision> {
  if (state.autoApprove) {
    return Promise.resolve(PERMISSION_DECISIONS.ALLOW_ONCE);
  }
  if (hasAllowed(state, req.conversationId, req.toolName)) {
    return Promise.resolve(PERMISSION_DECISIONS.ALLOW_ONCE);
  }
  return new Promise<PermissionDecision>((resolve) => {
    const event = registerPending(state, req, resolve);
    state.onPromptIframe(event);
  });
}

function handleResolve(
  state: BusState,
  requestId: string,
  decision: PermissionDecision,
): void {
  const pending = state.pending.get(requestId);
  if (!pending) {
    console.warn(
      `${PERMISSION_LOG_PREFIX} ${PERMISSION_UNKNOWN_REQUEST_REASON} (requestId=${requestId})`,
    );
    return;
  }
  settlePending(state, pending, decision);
}

function pendingToRequest(pending: PendingState): PendingRequest {
  return {
    requestId: pending.requestId,
    conversationId: pending.conversationId,
    toolName: pending.toolName,
    args: pending.args,
  };
}

function collectPendingForConversation(
  state: BusState,
  conversationId: string,
): PendingRequest[] {
  const out: PendingRequest[] = [];
  for (const pending of state.pending.values()) {
    if (pending.conversationId !== conversationId) continue;
    out.push(pendingToRequest(pending));
  }
  return out;
}

function buildState(opts: BusOptions): BusState {
  return {
    pending: new Map(),
    sessionAllowed: new Map(),
    timeoutMs: opts.timeoutMs ?? PERMISSION_TIMEOUT_MS,
    autoApprove: false,
    onPromptIframe: opts.onPromptIframe,
  };
}

export function createPermissionBus(opts: BusOptions): PermissionBus {
  const state = buildState(opts);
  return {
    requestPermission(req) {
      return startRequest(state, req);
    },
    resolvePermission(requestId, decision) {
      handleResolve(state, requestId, decision);
    },
    rememberSessionDecision(conversationId, toolName) {
      rememberDecision(state, conversationId, toolName);
    },
    hasSessionAllowed(conversationId, toolName) {
      return hasAllowed(state, conversationId, toolName);
    },
    forgetConversation(conversationId) {
      state.sessionAllowed.delete(conversationId);
    },
    getPendingForConversation(conversationId) {
      return collectPendingForConversation(state, conversationId);
    },
    setAutoApprove(autoApprove) {
      state.autoApprove = autoApprove;
    },
  };
}
