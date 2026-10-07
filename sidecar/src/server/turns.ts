import { extractEditedFilePath } from "../agent/edit-tracker.js";
import type { RunnerContext } from "../agent/runner.js";
import type { RunnerEvent } from "../agent/runner-events.js";
import { isEditTool } from "../agent/tool-kinds.js";
import { effectiveGenerationMode } from "../builder/capability.js";
import { MAX_AUTO_HEAL_ATTEMPTS } from "../constants/safety-net.js";
import { WS_LOG_PREFIX } from "../constants/ws.js";
import { type AnyServerEventType, EVENT_TYPES } from "../protocol/events.js";
import type { AttachmentType } from "../protocol/messages.js";
import { truncateTitle } from "../state/conversations.js";
import type { ChangeSetRecord, TokenUsage } from "../state/types.js";
import { broadcastConversationList, emitNotice } from "./chat-events.js";
import { inspectBuild } from "./safety-net.js";
import type { SidecarServices } from "./services.js";
import { endToolCall, startToolCall, stopOpenCalls } from "./tool-calls.js";
import { startTurnProgress } from "./turn-progress.js";

const AUTO_FIX_TITLE_PREFIX = "Auto-fix: ";

/** One turn to run: what the agent is sent and what the user asked. */
export interface TurnRequest {
  conversationId: string;
  // The text the agent is sent.
  content: string;
  // The user's request, for the change set title.
  request: string;
  attachments?: AttachmentType[];
  isAutoFix: boolean;
  includePageContext?: boolean;
}

function dispatch(
  services: SidecarServices,
  conversationId: string,
  event: AnyServerEventType,
  isTerminal: boolean,
): void {
  if (isTerminal) {
    services.liveTurns.end(conversationId);
  } else {
    services.liveTurns.append(conversationId, event);
  }
  services.chatSocketRegistry.send(conversationId, event);
}

function dispatchAll(
  services: SidecarServices,
  conversationId: string,
  events: AnyServerEventType[],
): void {
  for (const event of events) dispatch(services, conversationId, event, false);
}

function recordEditIfAny(
  services: SidecarServices,
  conversationId: string,
  ev: RunnerEvent,
): void {
  if (ev.type !== "tool_use" || !isEditTool(ev.toolName)) return;
  const filePath = extractEditedFilePath(ev.args);
  if (filePath !== undefined)
    services.editTracker.record(conversationId, filePath);
}

type TurnEventHandler<T extends RunnerEvent["type"]> = (
  services: SidecarServices,
  conversationId: string,
  ev: Extract<RunnerEvent, { type: T }>,
) => AnyServerEventType | null;

function endTurnEvents(
  services: SidecarServices,
  conversationId: string,
): void {
  dispatchAll(
    services,
    conversationId,
    stopOpenCalls(services, conversationId),
  );
}

const TURN_EVENT_HANDLERS: {
  [K in RunnerEvent["type"]]: TurnEventHandler<K>;
} = {
  assistant_text: (services, conversationId, ev) => {
    services.conversationStore.appendMessage(conversationId, {
      role: "assistant",
      content: ev.text,
      timestampMs: Date.now(),
    });
    return null;
  },
  assistant_text_delta: (_services, conversationId, ev) => ({
    type: EVENT_TYPES.ASSISTANT_MESSAGE_CHUNK,
    conversationId,
    text: ev.text,
  }),
  tool_use: (services, conversationId, ev) => {
    startToolCall(services, conversationId, ev);
    return {
      type: EVENT_TYPES.TOOL_CALL_START,
      conversationId,
      callId: ev.callId,
      toolName: ev.toolName,
      args: ev.args,
    };
  },
  tool_result: (services, conversationId, ev) =>
    endToolCall(services, conversationId, ev),
  done: (services, conversationId) => {
    endTurnEvents(services, conversationId);
    return { type: EVENT_TYPES.RUN_DONE, conversationId };
  },
  error: (services, conversationId, ev) => {
    endTurnEvents(services, conversationId);
    services.turns.recordError(ev.message);
    services.conversationStore.appendMessage(conversationId, {
      role: "error",
      content: ev.message,
      isRetryable: ev.isRetryable,
      timestampMs: Date.now(),
    });
    return {
      type: EVENT_TYPES.RUN_ERROR,
      conversationId,
      error: ev.message,
      isRetryable: ev.isRetryable,
    };
  },
  activity: () => null,
};

export function handleTurnEvent(
  services: SidecarServices,
  conversationId: string,
  ev: RunnerEvent,
): void {
  recordEditIfAny(services, conversationId, ev);
  const handler = TURN_EVENT_HANDLERS[ev.type] as TurnEventHandler<
    RunnerEvent["type"]
  >;
  const wireEvent = handler(services, conversationId, ev);
  if (wireEvent === null) return;
  const isTerminal = ev.type === "done" || ev.type === "error";
  dispatch(services, conversationId, wireEvent, isTerminal);
}

function sumUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

function addTurnUsage(
  services: SidecarServices,
  conversationId: string,
  usage: TokenUsage,
): void {
  const turn = services.turns.get(conversationId);
  if (turn !== undefined) {
    turn.usage = sumUsage(turn.usage, usage);
    return;
  }
  services.conversationStore.recordTurnUsage(conversationId, usage, Date.now());
}

function buildRunnerContext(
  services: SidecarServices,
  request: TurnRequest,
): RunnerContext {
  const { conversationId } = request;
  return {
    conversationId,
    hostProjectRoot: services.hostProjectRoot,
    getCurrentPage: () => services.hostState.getCurrentPage(),
    attachments: request.attachments,
    includePageContext: request.includePageContext,
    permissionBus: services.permissionBus,
    createMcpServer: () => services.createMcpServer(conversationId),
    onToolDecision: (decision) => {
      if (decision.callId === undefined || decision.callId === "") return;
      services.callAudit.record(conversationId, decision.callId, {
        allowedBy: decision.allowedBy,
        isPrompted: false,
      });
    },
    onToolAnnounced: (callId, toolName, args) =>
      services.callLedger.announce(conversationId, callId, toolName, args),
    beforeMutation: async () => {
      await services.turns.get(conversationId)?.checkpoint.ready();
    },
    onTokenUsage: (usage) => addTurnUsage(services, conversationId, usage),
  };
}

function beginTurn(services: SidecarServices, request: TurnRequest): void {
  const { conversationId } = request;
  services.liveTurns.begin(conversationId);
  // The selected provider is the one that runs, or the turn fails: there is no
  // longer a gap between what was chosen and what answered.
  services.conversationStore.markProvider(
    conversationId,
    services.settingsStore.get().provider,
  );
  services.conversationModes.pinDefaults(conversationId);
  services.turns.begin({
    conversationId,
    request: request.request,
    isAutoFix: request.isAutoFix,
    askedBy: services.askers.get(conversationId),
    pagePath: services.hostState.getCurrentPage().path,
    checkpoint: services.checkpoints.beginTurn(conversationId),
  });
  broadcastConversationList(services);
}

function publishChangeSet(
  services: SidecarServices,
  record: ChangeSetRecord,
  callIds: readonly string[],
): void {
  const { conversationId } = record;
  services.conversationStore.patchMessages(
    conversationId,
    (m) =>
      (m.role === "tool_use" || m.role === "tool_result") &&
      m.callId !== undefined &&
      callIds.includes(m.callId),
    { changeSetId: record.id },
  );
  services.conversationStore.appendMessage(conversationId, {
    role: "change_set",
    content: "",
    changeSetId: record.id,
    timestampMs: record.createdAtMs,
  });
  sendChangeSet(services, record);
}

export function sendChangeSet(
  services: SidecarServices,
  record: ChangeSetRecord,
): void {
  const changeSet = services.checkpoints
    .forConversation(record.conversationId)
    .find((c) => c.id === record.id);
  if (changeSet === undefined) return;
  services.chatSocketRegistry.send(record.conversationId, {
    type: EVENT_TYPES.CHANGE_SET,
    conversationId: record.conversationId,
    changeSet,
  });
}

async function recordChangeSet(
  services: SidecarServices,
  conversationId: string,
): Promise<ChangeSetRecord | null> {
  const turn = services.turns.get(conversationId);
  if (turn === undefined) return null;
  const mode = services.conversationModes.state(conversationId);
  const record = await turn.checkpoint.finish({
    conversationId,
    title: truncateTitle(
      turn.isAutoFix ? `${AUTO_FIX_TITLE_PREFIX}${turn.request}` : turn.request,
    ),
    agent: services.settingsStore.get().provider,
    scope: effectiveGenerationMode(mode.generationMode),
    isAutoFix: turn.isAutoFix,
    askedBy: turn.askedBy,
    approvalsNeeded: turn.approvalsNeeded,
    builderOps: turn.builderOps,
    typecheck: turn.typecheck,
    pagePath: turn.pagePath,
  });
  if (record !== null) publishChangeSet(services, record, turn.mutatingCallIds);
  return record;
}

function recordUsage(services: SidecarServices, conversationId: string): void {
  const usage = services.turns.get(conversationId)?.usage;
  if (usage !== undefined && usage.totalTokens > 0) {
    services.conversationStore.recordTurnUsage(
      conversationId,
      usage,
      Date.now(),
    );
  }
  const total =
    services.conversationStore.get(conversationId)?.tokenUsage?.totalTokens ??
    0;
  services.chatSocketRegistry.send(conversationId, {
    type: EVENT_TYPES.USAGE,
    conversationId,
    totalTokens: total,
  });
}

async function finishTurn(
  services: SidecarServices,
  conversationId: string,
): Promise<ChangeSetRecord | null> {
  endTurnEvents(services, conversationId);
  services.liveTurns.end(conversationId);
  try {
    return await recordChangeSet(services, conversationId);
  } finally {
    recordUsage(services, conversationId);
    services.turns.end(conversationId);
    services.conversationModes.endTurn(conversationId);
    broadcastConversationList(services);
  }
}

/**
 * Runs one model turn end to end: tracking, the provider stream, then the
 * change set and the usage it leaves. Resolves with the change set, if any.
 */
async function streamTurn(
  services: SidecarServices,
  request: TurnRequest,
): Promise<ChangeSetRecord | null> {
  const { conversationId } = request;
  beginTurn(services, request);
  const progress = startTurnProgress({
    conversationId,
    send: (event) => services.chatSocketRegistry.send(conversationId, event),
  });
  try {
    const stream = services.runner.start(
      request.content,
      buildRunnerContext(services, request),
    );
    for await (const ev of stream) {
      progress.observe(ev);
      handleTurnEvent(services, conversationId, ev);
    }
  } finally {
    progress.stop();
  }
  return finishTurn(services, conversationId);
}

async function streamTurnOrFail(
  services: SidecarServices,
  request: TurnRequest,
): Promise<ChangeSetRecord | null | undefined> {
  try {
    return await streamTurn(services, request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${WS_LOG_PREFIX} turn setup failed: ${message}`);
    await finishTurn(services, request.conversationId).catch(() => null);
    handleTurnEvent(services, request.conversationId, {
      type: "error",
      message,
    });
    return undefined;
  }
}

function applyTypecheck(
  services: SidecarServices,
  changeSet: ChangeSetRecord | null,
  typecheck: ChangeSetRecord["typecheck"],
): void {
  if (changeSet === null || typecheck === "skipped") return;
  const updated = services.checkpoints.setTypecheck(changeSet.id, typecheck);
  if (updated !== null) sendChangeSet(services, updated);
}

interface HealingPass {
  request: string;
  sinceMs: number;
  attempt: number;
  changeSet: ChangeSetRecord | null;
}

async function runSafetyNet(
  services: SidecarServices,
  conversationId: string,
  pass: HealingPass,
): Promise<void> {
  if (pass.attempt >= MAX_AUTO_HEAL_ATTEMPTS) return;
  if (services.turns.isAutoFixStopped(conversationId)) return;
  const editedFiles = services.editTracker.getEditedFiles(conversationId);
  if (editedFiles.length === 0) return;
  const report = await inspectBuild({
    editedFiles,
    knownRoots: [services.hostProjectRoot, ...services.moduleRoots],
    logsClient: services.logsClient,
    sinceMs: pass.sinceMs,
  });
  applyTypecheck(services, pass.changeSet, report.typecheck);
  if (report.healPrompt === null) return;
  if (services.turns.isAutoFixStopped(conversationId)) return;
  services.editTracker.clear(conversationId);
  const nextSinceMs = Date.now();
  emitNotice(services, conversationId, {
    kind: "autofix",
    attempt: pass.attempt + 1,
    maxAttempts: MAX_AUTO_HEAL_ATTEMPTS,
    errors: report.errors,
    timestampMs: nextSinceMs,
  });
  const changeSet = await streamTurnOrFail(services, {
    conversationId,
    content: report.healPrompt,
    request: pass.request,
    isAutoFix: true,
  });
  if (changeSet === undefined) return;
  await runSafetyNet(services, conversationId, {
    request: pass.request,
    sinceMs: nextSinceMs,
    attempt: pass.attempt + 1,
    changeSet,
  });
}

// One turn end-to-end: fresh edit tracking, the model turn, then the auto-heal
// safety net. A setup failure (before any stream event) emits a terminal
// run_error so the client never strands in its optimistic running state.
export async function runTurnWithHealing(
  services: SidecarServices,
  request: TurnRequest,
): Promise<void> {
  const { conversationId } = request;
  services.turns.resetAutoFix(conversationId);
  services.editTracker.clear(conversationId);
  const sinceMs = Date.now();
  const changeSet = await streamTurnOrFail(services, request);
  if (changeSet === undefined) return;
  // The auto-heal pass is best-effort; a failure in it must never propagate, or
  // it would abort the queue drain and strand the remaining follow-ups.
  try {
    await runSafetyNet(services, conversationId, {
      request: request.request,
      sinceMs,
      attempt: 0,
      changeSet,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${WS_LOG_PREFIX} safety net failed: ${message}`);
  }
}
