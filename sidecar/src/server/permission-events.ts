import {
  denialMessage,
  type PendingRequest,
  type PermissionDecisionRecord,
  type PermissionPolicy,
  type PermissionPrompt,
} from "../agent/permission-bus.js";
import type { PendingQuestion, QuestionReply } from "../agent/question-bus.js";
import {
  isBlockRemovalTool,
  isDestructiveBuilderTool,
} from "../agent/tool-kinds.js";
import { MS_PER_MINUTE } from "../constants/settings.js";
import { PERMISSION_SETTLEMENTS } from "../constants/permissions.js";
import type {
  BuilderGate,
  BuilderGateDecision,
} from "../mcp/tools/builder-gate.js";
import { EVENT_TYPES } from "../protocol/events.js";
import type { QuestionAnswerRecord } from "../state/types.js";
import {
  broadcastConversationList,
  buildAskQuestionEvent,
  buildPermissionRequestEvent,
  emitNotice,
  sendRulesState,
} from "./chat-events.js";
import type { SidecarServices } from "./services.js";

const ALLOWED: BuilderGateDecision = { isAllowed: true };

export function permissionPolicy(
  services: SidecarServices,
  conversationId: string,
): PermissionPolicy {
  const settings = services.settingsStore.get();
  return {
    hostProjectRoot: services.hostProjectRoot,
    isFullAuto: services.conversationModes.isFullAuto(conversationId),
    timeoutMs: settings.requestTimeoutMinutes * MS_PER_MINUTE,
    alwaysAskDependencies: settings.alwaysAskDependencies,
    alwaysAskBlockRemoval: settings.alwaysAskBlockRemoval,
  };
}

export function onPermissionPrompt(
  services: SidecarServices,
  request: PendingRequest,
): void {
  const turn = services.turns.get(request.conversationId);
  if (turn !== undefined) turn.approvalsNeeded++;
  services.chatSocketRegistry.send(
    request.conversationId,
    buildPermissionRequestEvent(request),
  );
  broadcastConversationList(services);
}

function persistPrompt(
  services: SidecarServices,
  record: PermissionDecisionRecord,
  prompt: PermissionPrompt,
): void {
  const { request } = prompt;
  services.conversationStore.appendMessage(record.conversationId, {
    role: "permission",
    content: "",
    toolName: record.toolName,
    callId: record.callId,
    requestId: request.requestId,
    decision: record.outcome.isAllowed ? "approved" : "denied",
    allowedBy: record.outcome.allowedBy,
    kind: request.kind,
    alwaysAsk: request.alwaysAsk,
    summary: request.summary,
    args: request.args,
    requestedAtMs: request.createdAtMs,
    expiresAtMs: request.expiresAtMs,
    feedback: record.outcome.feedback,
    decidedBy: prompt.decidedBy,
    timestampMs: prompt.decidedAtMs,
  });
}

function announceExpiry(services: SidecarServices, prompt: PermissionPrompt) {
  const { request } = prompt;
  services.chatSocketRegistry.send(request.conversationId, {
    type: EVENT_TYPES.PERMISSION_EXPIRED,
    conversationId: request.conversationId,
    requestId: request.requestId,
    toolName: request.toolName,
    summary: request.summary,
    expiredAtMs: prompt.decidedAtMs,
  });
  emitNotice(services, request.conversationId, {
    kind: "permission_expired",
    toolName: request.toolName,
    summary: request.summary,
    timestampMs: prompt.decidedAtMs,
  });
}

function announceSettlement(
  services: SidecarServices,
  prompt: PermissionPrompt,
): void {
  if (prompt.settledAs === PERMISSION_SETTLEMENTS.EXPIRED) {
    announceExpiry(services, prompt);
    return;
  }
  const { request } = prompt;
  const decision =
    prompt.settledAs === PERMISSION_SETTLEMENTS.CANCELLED
      ? "deny"
      : prompt.settledAs;
  services.chatSocketRegistry.send(request.conversationId, {
    type: EVENT_TYPES.PERMISSION_RESOLVED,
    conversationId: request.conversationId,
    requestId: request.requestId,
    decision,
  });
}

/** Every bus decision: audit it by call, and announce a prompted one. */
export function onPermissionDecided(
  services: SidecarServices,
  record: PermissionDecisionRecord,
): void {
  const { prompt } = record;
  if (record.callId !== undefined) {
    services.callAudit.record(record.conversationId, record.callId, {
      allowedBy: record.outcome.allowedBy,
      isPrompted: prompt !== undefined,
    });
  }
  if (prompt === undefined) return;
  persistPrompt(services, record, prompt);
  announceSettlement(services, prompt);
  broadcastConversationList(services);
}

/** deny_all: every request was refused; the turn is stopped too. */
export function interruptConversation(
  services: SidecarServices,
  conversationId: string,
): void {
  services.permissionBus.cancelConversation(conversationId);
  services.questionBus.cancelConversation(conversationId);
  services.runner.interruptSession(conversationId);
}

export function onRulesChanged(
  services: SidecarServices,
  conversationId: string,
): void {
  sendRulesState(services, conversationId);
}

export function onQuestionPrompt(
  services: SidecarServices,
  question: PendingQuestion,
): void {
  services.chatSocketRegistry.send(
    question.conversationId,
    buildAskQuestionEvent(question),
  );
  broadcastConversationList(services);
}

function answerRecords(
  question: PendingQuestion,
  reply: QuestionReply,
): QuestionAnswerRecord[] {
  return question.questions.map((asked, index) => {
    const isSkipped = reply.skipped[index] === true;
    const answer = isSkipped ? null : (reply.answers[index] ?? null);
    return {
      header: asked.header,
      question: asked.question,
      answer,
      skipped: isSkipped,
      isCustom:
        answer !== null && !asked.options.some((o) => o.label === answer),
    };
  });
}

export function onQuestionAnswered(
  services: SidecarServices,
  question: PendingQuestion,
  reply: QuestionReply,
): void {
  services.conversationStore.appendMessage(question.conversationId, {
    role: "question_answer",
    content: "",
    answers: answerRecords(question, reply),
    timestampMs: Date.now(),
  });
}

export function onQuestionExpired(
  services: SidecarServices,
  question: PendingQuestion,
): void {
  services.chatSocketRegistry.send(question.conversationId, {
    type: EVENT_TYPES.QUESTION_EXPIRED,
    conversationId: question.conversationId,
    requestId: question.requestId,
  });
}

function needsUser(services: SidecarServices, toolName: string): boolean {
  if (isDestructiveBuilderTool(toolName)) return true;
  return (
    services.settingsStore.get().alwaysAskBlockRemoval &&
    isBlockRemovalTool(toolName)
  );
}

/**
 * The Builder gate of one conversation: every mutating operation waits for
 * the turn's checkpoint, and deletions (plus block removals, by setting) wait
 * for the user through the permission bus.
 */
export function buildBuilderGate(
  services: SidecarServices,
  conversationId: string,
): BuilderGate {
  return async (toolName, args) => {
    await services.turns.get(conversationId)?.checkpoint.ready();
    if (!needsUser(services, toolName)) return ALLOWED;
    const outcome = await services.permissionBus.requestPermission({
      conversationId,
      toolName,
      args,
      callId: services.callLedger.claim(conversationId, toolName, args),
    });
    if (!outcome.isAllowed) {
      return { isAllowed: false, message: denialMessage(outcome) };
    }
    return { isAllowed: true, keepData: outcome.keepData };
  };
}
