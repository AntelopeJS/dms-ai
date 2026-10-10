import type {
  RunnerToolResult,
  RunnerToolUse,
} from "../agent/runner-events.js";
import {
  bareToolName,
  isCommandTool,
  isEditTool,
  isMutatingBuilderTool,
  isMutatingTool,
  isReadOnlyTool,
} from "../agent/tool-kinds.js";
import type {
  AllowedBy,
  ToolOutcome,
  TypecheckOutcome,
} from "../constants/audit.js";
import {
  TYPECHECK_CLEAN_MESSAGE,
  TYPECHECK_ERRORS_PREFIX,
  TYPECHECK_TOOL_NAME,
} from "../constants/typecheck.js";
import {
  EVENT_TYPES,
  STATUS,
  type ToolCallEndEventType,
} from "../protocol/events.js";
import type { CallDecision } from "../audit/call-audit.js";
import type { SidecarServices } from "./services.js";
import type { ActiveTurn } from "./turn-registry.js";

// What a call that ran without any recorded decision was allowed by. Claude
// runs the commands it deems read-only and, in Accept edits, the edits, without
// asking; Codex runs sandboxed commands the same way.
interface AllowedByMatcher {
  allowedBy: AllowedBy;
  matches: (toolName: string, isFullAuto: boolean) => boolean;
}

const DEFAULT_ALLOWED_BY: readonly AllowedByMatcher[] = [
  { allowedBy: "builder_auto", matches: (name) => isMutatingBuilderTool(name) },
  { allowedBy: "read_auto", matches: (name) => isReadOnlyTool(name) },
  { allowedBy: "full_auto", matches: (_name, isFullAuto) => isFullAuto },
  // Accepted by the conversation's Accept edits mode, a standing rule.
  { allowedBy: "rule", matches: (name) => isEditTool(name) },
  { allowedBy: "read_auto", matches: (name) => isCommandTool(name) },
];

const FALLBACK_ALLOWED_BY: AllowedBy = "read_auto";

const OUTCOME_BY_DECISION: Partial<Record<AllowedBy, ToolOutcome>> = {
  blocked: "blocked",
  denied: "denied",
  expired: "denied",
};

const STOPPED_RESULT = "stopped";

export function defaultAllowedBy(
  services: SidecarServices,
  conversationId: string,
  toolName: string,
): AllowedBy {
  const isFullAuto = services.conversationModes.isFullAuto(conversationId);
  return (
    DEFAULT_ALLOWED_BY.find((m) => m.matches(toolName, isFullAuto))
      ?.allowedBy ?? FALLBACK_ALLOWED_BY
  );
}

function decisionOf(
  services: SidecarServices,
  conversationId: string,
  callId: string,
): CallDecision | undefined {
  return services.callAudit.lookup(conversationId, callId);
}

function outcomeOf(
  ev: RunnerToolResult,
  decision: CallDecision | undefined,
): ToolOutcome {
  if (ev.isStopped === true) return "stopped";
  const decided =
    decision === undefined
      ? undefined
      : OUTCOME_BY_DECISION[decision.allowedBy];
  if (decided !== undefined) return decided;
  return ev.isError ? "failed" : "done";
}

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result ?? "");
  } catch {
    return "";
  }
}

const TYPECHECK_OUTCOME_MARKERS: ReadonlyArray<[string, TypecheckOutcome]> = [
  [TYPECHECK_ERRORS_PREFIX, "failed"],
  [TYPECHECK_CLEAN_MESSAGE, "passed"],
];

function noteTypecheck(turn: ActiveTurn, toolName: string, result: unknown) {
  if (bareToolName(toolName) !== TYPECHECK_TOOL_NAME) return;
  const text = resultText(result);
  const marker = TYPECHECK_OUTCOME_MARKERS.find(([m]) => text.includes(m));
  if (marker !== undefined) turn.typecheck = marker[1];
}

/** Persists a call as it starts and tracks it on the running turn. */
export function startToolCall(
  services: SidecarServices,
  conversationId: string,
  ev: RunnerToolUse,
): void {
  const turn = services.turns.get(conversationId);
  turn?.openCalls.set(ev.callId, {
    toolName: ev.toolName,
    startedAtMs: Date.now(),
  });
  if (turn !== undefined && isMutatingTool(ev.toolName)) {
    turn.mutatingCallIds.push(ev.callId);
  }
  services.conversationStore.appendMessage(conversationId, {
    role: "tool_use",
    content: JSON.stringify(ev.args ?? null),
    toolName: ev.toolName,
    callId: ev.callId,
    allowedBy: decisionOf(services, conversationId, ev.callId)?.allowedBy,
    isAutoFix: turn?.isAutoFix === true ? true : undefined,
    timestampMs: Date.now(),
  });
}

function toolNameOf(
  services: SidecarServices,
  conversationId: string,
  callId: string,
): string {
  const open = services.turns.get(conversationId)?.openCalls.get(callId);
  if (open !== undefined) return open.toolName;
  const messages = services.conversationStore.get(conversationId)?.messages;
  const stored = [...(messages ?? [])]
    .reverse()
    .find((m) => m.role === "tool_use" && m.callId === callId);
  return stored?.toolName ?? "";
}

function trackEnd(
  turn: ActiveTurn | undefined,
  ev: RunnerToolResult,
  toolName: string,
  outcome: ToolOutcome,
): void {
  if (turn === undefined) return;
  turn.openCalls.delete(ev.callId);
  noteTypecheck(turn, toolName, ev.result);
  if (outcome === "done" && isMutatingBuilderTool(toolName)) turn.builderOps++;
}

/**
 * Ends a call: works out its outcome and how it was allowed, persists both on
 * the stored result (and the way it was allowed on the stored call), and
 * answers the event the chat is sent.
 */
export function endToolCall(
  services: SidecarServices,
  conversationId: string,
  ev: RunnerToolResult,
): ToolCallEndEventType {
  const toolName = toolNameOf(services, conversationId, ev.callId);
  const decision = decisionOf(services, conversationId, ev.callId);
  const outcome = outcomeOf(ev, decision);
  const allowedBy =
    decision?.allowedBy ?? defaultAllowedBy(services, conversationId, toolName);
  trackEnd(services.turns.get(conversationId), ev, toolName, outcome);
  const status = ev.isError ? STATUS.ERROR : STATUS.SUCCESS;
  services.conversationStore.patchMessages(
    conversationId,
    (m) => m.role === "tool_use" && m.callId === ev.callId,
    { allowedBy },
  );
  services.conversationStore.appendMessage(conversationId, {
    role: "tool_result",
    content: JSON.stringify(ev.result ?? null),
    callId: ev.callId,
    status,
    outcome,
    allowedBy,
    timestampMs: Date.now(),
  });
  return {
    type: EVENT_TYPES.TOOL_CALL_END,
    conversationId,
    callId: ev.callId,
    status,
    result: ev.result,
    outcome,
    allowedBy,
  };
}

/** The calls a cut-short turn left open, ended as `stopped`. */
export function stopOpenCalls(
  services: SidecarServices,
  conversationId: string,
): ToolCallEndEventType[] {
  const turn = services.turns.get(conversationId);
  if (turn === undefined) return [];
  return [...turn.openCalls.keys()].map((callId) =>
    endToolCall(services, conversationId, {
      type: "tool_result",
      callId,
      result: STOPPED_RESULT,
      isError: true,
      isStopped: true,
    }),
  );
}
