import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  EDIT_TOOL_NAMES,
  type EditTracker,
  extractEditedFilePath,
} from "../agent/edit-tracker.js";
import type { PendingRequest, PermissionBus } from "../agent/permission-bus.js";
import type { PendingQuestion, QuestionBus } from "../agent/question-bus.js";
import type { AgentRunner } from "../agent/runner.js";
import type { RunnerEvent } from "../agent/runner-events.js";
import { buildToolSummary } from "../agent/tool-summary.js";
import { getBuilderAvailable } from "../builder/capability.js";
import {
  PERMISSION_DECISIONS,
  type PermissionDecision,
} from "../constants/permissions.js";
import { MAX_AUTO_HEAL_ATTEMPTS } from "../constants/safety-net.js";
import { WS_LOG_PREFIX } from "../constants/ws.js";
import type { LogsClient } from "../logs/logs-client.js";
import type { AiMcpServer } from "../mcp/types.js";
import {
  type AnyServerEventType,
  type AskQuestionEventType,
  type ConversationListEventType,
  type ConversationSnapshotEventType,
  EVENT_TYPES,
  type PermissionRequestEventType,
  type QueueStateEventType,
  type RunResumedEventType,
  type SettingsUpdateEventType,
  STATUS,
  type UserMessageEchoEventType,
} from "../protocol/events.js";
import {
  AnyClientMessage,
  type AnyClientMessageType,
  type AttachmentType,
  type ClientHelloMsgType,
  MESSAGE_TYPES,
  type QueuedItemType,
  ROLE,
  type ServerEchoReplyMsgType,
  type UserMessageMsgType,
} from "../protocol/messages.js";
import { getProviderAvailability } from "../providers/registry.js";
import type { ConversationStore } from "../state/conversations.js";
import type { HostState } from "../state/host-state.js";
import type { SettingsStore } from "../state/settings-store.js";
import type { AppSettings } from "../state/settings-types.js";
import type { StoredMessage } from "../state/types.js";
import type { HostSocketRegistry } from "./host-socket-registry.js";
import type { IdleShutdownController } from "./idle-shutdown.js";
import type { IframeSocketRegistry } from "./iframe-socket-registry.js";
import type { LiveTurnStore } from "./live-turns.js";
import type { NavigationCompleter } from "./navigation-completer.js";
import type { PendingQueueStore } from "./pending-queue.js";
import { collectBuildIssues } from "./safety-net.js";

export interface ConnectionContext {
  path: string;
  hostProjectRoot: string;
  runner: AgentRunner;
  conversationStore: ConversationStore;
  permissionBus: PermissionBus;
  questionBus: QuestionBus;
  createMcpServer: (conversationId: string) => AiMcpServer;
  editTracker: EditTracker;
  logsClient: LogsClient;
  moduleRoots: string[];
  hostState: HostState;
  hostSocketRegistry: HostSocketRegistry;
  iframeSocketRegistry: IframeSocketRegistry;
  navigationCompleter: NavigationCompleter;
  liveTurns: LiveTurnStore;
  pendingQueue: PendingQueueStore;
  settingsStore: SettingsStore;
}

export interface RoutingConfig {
  hostProjectRoot: string;
  conversationStore: ConversationStore;
  createMcpServer: (conversationId: string) => AiMcpServer;
  hostState: HostState;
  hostSocketRegistry: HostSocketRegistry;
  iframeSocketRegistry: IframeSocketRegistry;
  permissionBus: PermissionBus;
  questionBus: QuestionBus;
  editTracker: EditTracker;
  logsClient: LogsClient;
  moduleRoots: string[];
  navigationCompleter: NavigationCompleter;
  idleController: IdleShutdownController;
  runner: AgentRunner;
  liveTurns: LiveTurnStore;
  pendingQueue: PendingQueueStore;
  settingsStore: SettingsStore;
}

type ClientMessageHandler = (
  socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
) => void | Promise<void>;

function buildSnapshotEvent(
  conversationId: string,
  messages: readonly StoredMessage[],
): ConversationSnapshotEventType {
  return {
    type: EVENT_TYPES.CONVERSATION_SNAPSHOT,
    conversationId,
    // "permission" records are audit-only (drive the activity metrics); they're
    // not part of the visible transcript, so keep them out of the chatbox.
    messages: messages
      .filter((m) => m.role !== "permission")
      .map((m) => ({ ...m })),
  };
}

function sendSnapshotIfKnown(
  socket: WebSocket,
  ctx: ConnectionContext,
  msg: ClientHelloMsgType,
): void {
  if (msg.role !== ROLE.IFRAME) return;
  sendSettings(socket, ctx);
  if (msg.conversationId === undefined) return;
  sendConversationSnapshot(socket, ctx, msg.conversationId);
  replayLiveTurn(socket, ctx, msg.conversationId);
  sendQueueState(socket, ctx, msg.conversationId);
  resendPendingPermissions(socket, ctx, msg.conversationId);
  resendPendingQuestions(socket, ctx, msg.conversationId);
}

function sendQueueState(
  socket: WebSocket,
  ctx: ConnectionContext,
  conversationId: string,
): void {
  // Always sent on re-attach, even when empty: the queue is the server's
  // authoritative state, so an empty payload must clear any stale client mirror
  // (e.g. follow-ups the server drained while the client was disconnected).
  const event: QueueStateEventType = {
    type: EVENT_TYPES.QUEUE_STATE,
    conversationId,
    items: ctx.pendingQueue.get(conversationId),
  };
  socket.send(JSON.stringify(event));
}

function buildSettingsUpdateEvent(
  ctx: ConnectionContext,
): SettingsUpdateEventType {
  return {
    type: EVENT_TYPES.SETTINGS_UPDATE,
    settings: ctx.settingsStore.get(),
    builderAvailable: getBuilderAvailable(),
    providers: getProviderAvailability(),
  };
}

function sendSettings(socket: WebSocket, ctx: ConnectionContext): void {
  socket.send(JSON.stringify(buildSettingsUpdateEvent(ctx)));
}

function buildRunResumedEvent(conversationId: string): RunResumedEventType {
  return { type: EVENT_TYPES.RUN_RESUMED, conversationId };
}

function replayLiveTurn(
  socket: WebSocket,
  ctx: ConnectionContext,
  conversationId: string,
): void {
  const events = ctx.liveTurns.replay(conversationId);
  if (events === null) return;
  socket.send(JSON.stringify(buildRunResumedEvent(conversationId)));
  for (const event of events) {
    socket.send(JSON.stringify(event));
  }
}

function sendConversationSnapshot(
  socket: WebSocket,
  ctx: ConnectionContext,
  conversationId: string,
): void {
  const conversation = ctx.conversationStore.get(conversationId);
  if (conversation === null) return;
  const event = buildSnapshotEvent(conversationId, conversation.messages);
  socket.send(JSON.stringify(event));
}

function resendPendingPermissions(
  socket: WebSocket,
  ctx: ConnectionContext,
  conversationId: string,
): void {
  const pending = ctx.permissionBus.getPendingForConversation(conversationId);
  for (const request of pending) {
    sendPermissionRequest(socket, request);
  }
}

function resendPendingQuestions(
  socket: WebSocket,
  ctx: ConnectionContext,
  conversationId: string,
): void {
  const pending = ctx.questionBus.getPendingForConversation(conversationId);
  for (const question of pending) {
    sendQuestionRequest(socket, question);
  }
}

function registerHostSocketIfHost(
  socket: WebSocket,
  msg: ClientHelloMsgType,
  ctx: ConnectionContext,
): void {
  if (msg.role !== ROLE.HOST) return;
  ctx.hostSocketRegistry.set(socket);
}

function registerIframeSocketIfIframe(
  socket: WebSocket,
  msg: ClientHelloMsgType,
  ctx: ConnectionContext,
): void {
  if (msg.role !== ROLE.IFRAME) return;
  if (msg.conversationId === undefined) return;
  ctx.iframeSocketRegistry.set(msg.conversationId, socket);
}

function handleHello(
  socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
): void {
  if (msg.type !== MESSAGE_TYPES.HELLO) return;
  console.log(`${WS_LOG_PREFIX} hello role=${msg.role} path=${ctx.path}`);
  registerHostSocketIfHost(socket, msg, ctx);
  registerIframeSocketIfIframe(socket, msg, ctx);
  sendSnapshotIfKnown(socket, ctx, msg);
}

function handleEcho(socket: WebSocket, msg: AnyClientMessageType): void {
  if (msg.type !== MESSAGE_TYPES.ECHO) return;
  const reply: ServerEchoReplyMsgType = {
    type: MESSAGE_TYPES.ECHO_REPLY,
    payload: msg.payload,
    serverTimeMs: Date.now(),
  };
  socket.send(JSON.stringify(reply));
}

type RunnerEventMapper<T extends RunnerEvent["type"]> = (
  ev: Extract<RunnerEvent, { type: T }>,
  conversationId: string,
) => AnyServerEventType | null;

const RUNNER_EVENT_MAPPERS: {
  [K in RunnerEvent["type"]]: RunnerEventMapper<K>;
} = {
  assistant_text: () => null,
  assistant_text_delta: (ev, cid) => ({
    type: EVENT_TYPES.ASSISTANT_MESSAGE_CHUNK,
    conversationId: cid,
    text: ev.text,
  }),
  tool_use: (ev, cid) => ({
    type: EVENT_TYPES.TOOL_CALL_START,
    conversationId: cid,
    callId: ev.callId,
    toolName: ev.toolName,
    args: ev.args,
  }),
  tool_result: (ev, cid) => ({
    type: EVENT_TYPES.TOOL_CALL_END,
    conversationId: cid,
    callId: ev.callId,
    status: ev.isError ? STATUS.ERROR : STATUS.SUCCESS,
    result: ev.result,
  }),
  done: (_ev, cid) => ({
    type: EVENT_TYPES.RUN_DONE,
    conversationId: cid,
  }),
  error: (ev, cid) => ({
    type: EVENT_TYPES.RUN_ERROR,
    conversationId: cid,
    error: ev.message,
  }),
};

function mapRunnerEvent(
  ev: RunnerEvent,
  conversationId: string,
): AnyServerEventType | null {
  const mapper = RUNNER_EVENT_MAPPERS[ev.type] as RunnerEventMapper<
    RunnerEvent["type"]
  >;
  return mapper(ev, conversationId);
}

type RunnerEventPersister<T extends RunnerEvent["type"]> = (
  ev: Extract<RunnerEvent, { type: T }>,
  nowMs: number,
) => StoredMessage | null;

const RUNNER_EVENT_PERSISTERS: {
  [K in RunnerEvent["type"]]: RunnerEventPersister<K>;
} = {
  assistant_text: (ev, nowMs) => ({
    role: "assistant",
    content: ev.text,
    timestampMs: nowMs,
  }),
  assistant_text_delta: () => null,
  tool_use: (ev, nowMs) => ({
    role: "tool_use",
    content: JSON.stringify(ev.args ?? null),
    toolName: ev.toolName,
    callId: ev.callId,
    timestampMs: nowMs,
  }),
  tool_result: (ev, nowMs) => ({
    role: "tool_result",
    content: JSON.stringify(ev.result ?? null),
    callId: ev.callId,
    status: ev.isError ? STATUS.ERROR : STATUS.SUCCESS,
    timestampMs: nowMs,
  }),
  done: () => null,
  error: () => null,
};

function persistRunnerEvent(
  ctx: ConnectionContext,
  conversationId: string,
  ev: RunnerEvent,
): void {
  const persister = RUNNER_EVENT_PERSISTERS[ev.type] as RunnerEventPersister<
    RunnerEvent["type"]
  >;
  const stored = persister(ev, Date.now());
  if (stored === null) return;
  ctx.conversationStore.appendMessage(conversationId, stored);
}

function isTerminalEvent(ev: RunnerEvent): boolean {
  return ev.type === "done" || ev.type === "error";
}

function dispatchTurnEvent(
  ctx: ConnectionContext,
  conversationId: string,
  ev: RunnerEvent,
): void {
  const wireEvent = mapRunnerEvent(ev, conversationId);
  if (wireEvent === null) return;
  if (isTerminalEvent(ev)) {
    ctx.liveTurns.end(conversationId);
  } else {
    ctx.liveTurns.append(conversationId, wireEvent);
  }
  ctx.iframeSocketRegistry.send(conversationId, wireEvent);
}

function persistUserMessageContent(
  ctx: ConnectionContext,
  conversationId: string,
  content: string,
): void {
  ctx.conversationStore.appendMessage(conversationId, {
    role: "user",
    content,
    timestampMs: Date.now(),
  });
}

// Persist only lightweight metadata (name/type/size) for redisplay — never the
// base64 payload, which would bloat the transcript store.
function toStoredAttachmentMeta(
  attachments: readonly AttachmentType[],
): StoredMessage["attachments"] {
  if (attachments.length === 0) return undefined;
  return attachments.map((a) => ({
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
  }));
}

function persistUserMessage(
  ctx: ConnectionContext,
  msg: UserMessageMsgType,
): void {
  ctx.conversationStore.appendMessage(msg.conversationId, {
    role: "user",
    content: msg.content,
    attachments: toStoredAttachmentMeta(msg.attachments ?? []),
    timestampMs: Date.now(),
  });
}

function persistPermissionDecision(
  ctx: ConnectionContext,
  conversationId: string,
  toolName: string,
  decision: PermissionDecision,
): void {
  ctx.conversationStore.appendMessage(conversationId, {
    role: "permission",
    content: "",
    toolName,
    decision: decision === PERMISSION_DECISIONS.DENY ? "denied" : "approved",
    timestampMs: Date.now(),
  });
}

function recordEditIfAny(
  ctx: ConnectionContext,
  conversationId: string,
  ev: RunnerEvent,
): void {
  if (ev.type !== "tool_use") return;
  if (!EDIT_TOOL_NAMES.has(ev.toolName)) return;
  const filePath = extractEditedFilePath(ev.args);
  if (filePath !== undefined) ctx.editTracker.record(conversationId, filePath);
}

async function streamTurn(
  ctx: ConnectionContext,
  conversationId: string,
  content: string,
  attachments?: AttachmentType[],
): Promise<void> {
  ctx.liveTurns.begin(conversationId);
  // The selected provider is the one that runs, or the turn fails: there is no
  // longer a gap between what was chosen and what answered.
  ctx.conversationStore.markProvider(
    conversationId,
    ctx.settingsStore.get().provider,
  );
  try {
    const stream = ctx.runner.start(content, {
      conversationId,
      hostProjectRoot: ctx.hostProjectRoot,
      getCurrentPage: () => ctx.hostState.getCurrentPage(),
      attachments,
      permissionBus: ctx.permissionBus,
      createMcpServer: () => ctx.createMcpServer(conversationId),
      onPermissionDecision: (toolName, decision) =>
        persistPermissionDecision(ctx, conversationId, toolName, decision),
      onTokenUsage: (usage) =>
        ctx.conversationStore.addTokenUsage(conversationId, usage),
    });
    for await (const ev of stream) {
      recordEditIfAny(ctx, conversationId, ev);
      persistRunnerEvent(ctx, conversationId, ev);
      dispatchTurnEvent(ctx, conversationId, ev);
    }
  } finally {
    ctx.liveTurns.end(conversationId);
  }
}

async function runSafetyNet(
  ctx: ConnectionContext,
  conversationId: string,
  sinceMs: number,
  attempt: number,
): Promise<void> {
  if (attempt >= MAX_AUTO_HEAL_ATTEMPTS) return;
  const editedFiles = ctx.editTracker.getEditedFiles(conversationId);
  if (editedFiles.length === 0) return;
  const healPrompt = await collectBuildIssues({
    editedFiles,
    knownRoots: [ctx.hostProjectRoot, ...ctx.moduleRoots],
    logsClient: ctx.logsClient,
    sinceMs,
  });
  if (healPrompt === null) return;
  ctx.editTracker.clear(conversationId);
  const nextSinceMs = Date.now();
  persistUserMessageContent(ctx, conversationId, healPrompt);
  await streamTurn(ctx, conversationId, healPrompt);
  await runSafetyNet(ctx, conversationId, nextSinceMs, attempt + 1);
}

// One turn end-to-end: fresh edit tracking, the model turn, then the auto-heal
// safety net. A setup failure (before any stream event) emits a terminal
// run_error so the client never strands in its optimistic running state.
async function runTurnWithHealing(
  ctx: ConnectionContext,
  conversationId: string,
  content: string,
  attachments?: AttachmentType[],
): Promise<void> {
  ctx.editTracker.clear(conversationId);
  const sinceMs = Date.now();
  try {
    await streamTurn(ctx, conversationId, content, attachments);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${WS_LOG_PREFIX} turn setup failed: ${message}`);
    ctx.iframeSocketRegistry.send(conversationId, {
      type: EVENT_TYPES.RUN_ERROR,
      conversationId,
      error: message,
    });
    return;
  }
  // The auto-heal pass is best-effort; a failure in it must never propagate, or
  // it would abort the queue drain and strand the remaining follow-ups.
  try {
    await runSafetyNet(ctx, conversationId, sinceMs, 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${WS_LOG_PREFIX} safety net failed: ${message}`);
  }
}

function persistQueuedUserMessage(
  ctx: ConnectionContext,
  conversationId: string,
  item: QueuedItemType,
): void {
  ctx.conversationStore.appendMessage(conversationId, {
    role: "user",
    content: item.content,
    attachments: toStoredAttachmentMeta(item.attachments ?? []),
    timestampMs: Date.now(),
  });
}

function sendUserEcho(
  ctx: ConnectionContext,
  conversationId: string,
  item: QueuedItemType,
): void {
  const event: UserMessageEchoEventType = {
    type: EVENT_TYPES.USER_MESSAGE_ECHO,
    conversationId,
    content: item.content,
    attachments: toStoredAttachmentMeta(item.attachments ?? []),
    timestampMs: Date.now(),
  };
  ctx.iframeSocketRegistry.send(conversationId, event);
}

function broadcastQueueState(
  ctx: ConnectionContext,
  conversationId: string,
): void {
  const event: QueueStateEventType = {
    type: EVENT_TYPES.QUEUE_STATE,
    conversationId,
    items: ctx.pendingQueue.get(conversationId),
  };
  ctx.iframeSocketRegistry.send(conversationId, event);
}

// Server-owned dequeue: run queued follow-ups one at a time until the queue is
// empty. The caller holds the per-conversation drain lock, so this is the sole
// writer that consumes items — a client reconnect can restore the queue but can
// never resurrect an item already dequeued here, nor run one twice.
async function drainConversation(
  ctx: ConnectionContext,
  conversationId: string,
): Promise<void> {
  for (;;) {
    const next = ctx.pendingQueue.shift(conversationId);
    if (next === null) return;
    // The item is already removed from the queue, so a failure here must not
    // abort the loop — log and advance to the next follow-up rather than
    // stranding it and everything behind it.
    try {
      broadcastQueueState(ctx, conversationId);
      persistQueuedUserMessage(ctx, conversationId, next);
      sendUserEcho(ctx, conversationId, next);
      await runTurnWithHealing(
        ctx,
        conversationId,
        next.content,
        next.attachments,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`${WS_LOG_PREFIX} queued turn failed: ${message}`);
    }
  }
}

// Start draining if no drain is already active for this conversation. Called
// whenever the queue may have gained work while idle (an enqueue that races a
// finishing drain); the lock makes concurrent calls no-ops.
async function ensureDraining(
  ctx: ConnectionContext,
  conversationId: string,
): Promise<void> {
  if (!ctx.pendingQueue.tryStartDrain(conversationId)) return;
  try {
    await drainConversation(ctx, conversationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${WS_LOG_PREFIX} drain failed: ${message}`);
  } finally {
    ctx.pendingQueue.endDrain(conversationId);
  }
}

function enqueueUserMessage(
  ctx: ConnectionContext,
  msg: UserMessageMsgType,
): void {
  // `attachments` is set rather than spread: a queued message without any has
  // no `attachments` key, which is what the queue's readers expect.
  const queued: QueuedItemType = {
    id: randomUUID(),
    content: msg.content,
  };
  if (msg.attachments && msg.attachments.length > 0) {
    queued.attachments = msg.attachments;
  }
  ctx.pendingQueue.enqueue(msg.conversationId, queued);
  broadcastQueueState(ctx, msg.conversationId);
}

async function runUserMessage(
  _socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
): Promise<void> {
  if (msg.type !== MESSAGE_TYPES.USER_MESSAGE) return;
  // If a drain is already active (the client sent an immediate message while the
  // server still considers a run in flight), fold it into the queue so the one
  // active drain runs it — preserving ordering and the single-writer invariant.
  if (!ctx.pendingQueue.tryStartDrain(msg.conversationId)) {
    enqueueUserMessage(ctx, msg);
    void ensureDraining(ctx, msg.conversationId);
    return;
  }
  try {
    persistUserMessage(ctx, msg);
    await runTurnWithHealing(
      ctx,
      msg.conversationId,
      msg.content,
      msg.attachments,
    );
    await drainConversation(ctx, msg.conversationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${WS_LOG_PREFIX} run failed: ${message}`);
  } finally {
    ctx.pendingQueue.endDrain(msg.conversationId);
  }
}

function handleQueueEnqueue(
  _socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
): void {
  if (msg.type !== MESSAGE_TYPES.QUEUE_ENQUEUE) return;
  ctx.pendingQueue.enqueue(msg.conversationId, msg.item);
  broadcastQueueState(ctx, msg.conversationId);
  void ensureDraining(ctx, msg.conversationId);
}

function handleQueueCancel(
  _socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
): void {
  if (msg.type !== MESSAGE_TYPES.QUEUE_CANCEL) return;
  ctx.pendingQueue.cancel(msg.conversationId, msg.id);
  broadcastQueueState(ctx, msg.conversationId);
}

function handlePermissionResponse(
  _socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
): void {
  if (msg.type !== MESSAGE_TYPES.PERMISSION_RESPONSE) return;
  ctx.permissionBus.resolvePermission(msg.requestId, msg.decision);
}

function handleQuestionResponse(
  _socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
): void {
  if (msg.type !== MESSAGE_TYPES.QUESTION_RESPONSE) return;
  ctx.questionBus.resolveQuestion(msg.requestId, msg.answers);
}

function handleInterruptTurn(
  _socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
): void {
  if (msg.type !== MESSAGE_TYPES.INTERRUPT_TURN) return;
  // Unblock any tool the turn is paused on (awaiting permission), then signal
  // the SDK to wind the turn down; both are needed so the run can settle.
  for (const pending of ctx.permissionBus.getPendingForConversation(
    msg.conversationId,
  )) {
    ctx.permissionBus.resolvePermission(
      pending.requestId,
      PERMISSION_DECISIONS.DENY,
    );
  }
  // Unblock any tool paused awaiting a question answer too, so the turn settles.
  ctx.questionBus.cancelConversation(msg.conversationId);
  ctx.runner.interruptSession(msg.conversationId);
}

function handleHostStateUpdate(
  _socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
): void {
  if (msg.type !== MESSAGE_TYPES.HOST_STATE_UPDATE) return;
  ctx.hostState.setCurrentPage(msg.currentPage);
}

function handleHostNavigationComplete(
  _socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
): void {
  if (msg.type !== MESSAGE_TYPES.HOST_NAVIGATION_COMPLETE) return;
  ctx.navigationCompleter.complete(msg.path);
}

function buildConversationListEvent(
  ctx: ConnectionContext,
): ConversationListEventType {
  return {
    type: EVENT_TYPES.CONVERSATION_LIST,
    conversations: ctx.conversationStore.list(),
  };
}

function sendConversationList(socket: WebSocket, ctx: ConnectionContext): void {
  socket.send(JSON.stringify(buildConversationListEvent(ctx)));
}

function handleListConversations(
  socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
): void {
  if (msg.type !== MESSAGE_TYPES.LIST_CONVERSATIONS) return;
  sendConversationList(socket, ctx);
}

function handleDeleteConversation(
  socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
): void {
  if (msg.type !== MESSAGE_TYPES.DELETE_CONVERSATION) return;
  ctx.conversationStore.delete(msg.conversationId);
  ctx.permissionBus.forgetConversation(msg.conversationId);
  ctx.questionBus.cancelConversation(msg.conversationId);
  ctx.editTracker.clear(msg.conversationId);
  ctx.runner.disposeSession(msg.conversationId);
  ctx.liveTurns.end(msg.conversationId);
  ctx.pendingQueue.clear(msg.conversationId);
  sendConversationList(socket, ctx);
}

export interface SettingsApplyDeps {
  settingsStore: SettingsStore;
  permissionBus: PermissionBus;
  runner: AgentRunner;
  iframeSocketRegistry: IframeSocketRegistry;
}

// Single source of truth for applying a settings change, whether it arrives over
// the iframe WS (chatbox mode bar) or the HTTP API (Settings admin page). Always
// broadcasts the new settings to every connected iframe so both stay in sync.
export function applySettings(
  deps: SettingsApplyDeps,
  next: AppSettings,
): void {
  deps.settingsStore.set(next);
  deps.permissionBus.setAutoApprove(next.mode === "auto");
  deps.runner.applySettings(next);
  deps.iframeSocketRegistry.broadcast({
    type: EVENT_TYPES.SETTINGS_UPDATE,
    settings: next,
    builderAvailable: getBuilderAvailable(),
    providers: getProviderAvailability(),
  });
}

function handleSetSettings(
  _socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
): void {
  if (msg.type !== MESSAGE_TYPES.SET_SETTINGS) return;
  applySettings(ctx, {
    // Absent from an older chatbox: keep what is stored rather than reset it.
    provider: msg.provider ?? ctx.settingsStore.get().provider,
    mode: msg.mode,
    thinking: msg.thinking,
    generationMode: msg.generationMode,
    allowLocalSkills: msg.allowLocalSkills,
  });
}

function handleRequestHostNavigate(
  _socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
): void {
  if (msg.type !== MESSAGE_TYPES.REQUEST_HOST_NAVIGATE) return;
  ctx.hostSocketRegistry.send({
    type: EVENT_TYPES.HOST_COMMAND_NAVIGATE,
    path: msg.path,
  });
}

const MESSAGE_HANDLERS: Record<string, ClientMessageHandler> = {
  [MESSAGE_TYPES.HELLO]: handleHello,
  [MESSAGE_TYPES.ECHO]: handleEcho,
  [MESSAGE_TYPES.USER_MESSAGE]: runUserMessage,
  [MESSAGE_TYPES.PERMISSION_RESPONSE]: handlePermissionResponse,
  [MESSAGE_TYPES.QUESTION_RESPONSE]: handleQuestionResponse,
  [MESSAGE_TYPES.INTERRUPT_TURN]: handleInterruptTurn,
  [MESSAGE_TYPES.HOST_STATE_UPDATE]: handleHostStateUpdate,
  [MESSAGE_TYPES.HOST_NAVIGATION_COMPLETE]: handleHostNavigationComplete,
  [MESSAGE_TYPES.LIST_CONVERSATIONS]: handleListConversations,
  [MESSAGE_TYPES.DELETE_CONVERSATION]: handleDeleteConversation,
  [MESSAGE_TYPES.SET_SETTINGS]: handleSetSettings,
  [MESSAGE_TYPES.REQUEST_HOST_NAVIGATE]: handleRequestHostNavigate,
  [MESSAGE_TYPES.QUEUE_ENQUEUE]: handleQueueEnqueue,
  [MESSAGE_TYPES.QUEUE_CANCEL]: handleQueueCancel,
};

function parseMessage(raw: string): AnyClientMessageType | null {
  try {
    const parsed = JSON.parse(raw);
    const result = AnyClientMessage.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

export function dispatchMessage(
  socket: WebSocket,
  raw: string,
  ctx: ConnectionContext,
): void {
  const msg = parseMessage(raw);
  if (msg === null) {
    console.warn(`${WS_LOG_PREFIX} invalid message on ${ctx.path}`);
    return;
  }
  const handler = MESSAGE_HANDLERS[msg.type];
  if (handler === undefined) return;
  void handler(socket, msg, ctx);
}

function buildPermissionRequestEvent(
  event: PendingRequest,
): PermissionRequestEventType {
  return {
    type: EVENT_TYPES.PERMISSION_REQUEST,
    conversationId: event.conversationId,
    requestId: event.requestId,
    toolName: event.toolName,
    args: event.args,
    summary: buildToolSummary(event.toolName, event.args),
  };
}

function sendPermissionRequest(socket: WebSocket, event: PendingRequest): void {
  const wireEvent = buildPermissionRequestEvent(event);
  socket.send(JSON.stringify(wireEvent));
}

function buildAskQuestionEvent(event: PendingQuestion): AskQuestionEventType {
  return {
    type: EVENT_TYPES.ASK_QUESTION,
    conversationId: event.conversationId,
    requestId: event.requestId,
    questions: event.questions,
  };
}

function sendQuestionRequest(socket: WebSocket, event: PendingQuestion): void {
  const wireEvent = buildAskQuestionEvent(event);
  socket.send(JSON.stringify(wireEvent));
}

export function buildConnectionContext(
  _socket: WebSocket,
  path: string,
  config: RoutingConfig,
): ConnectionContext {
  return {
    path,
    hostProjectRoot: config.hostProjectRoot,
    runner: config.runner,
    conversationStore: config.conversationStore,
    permissionBus: config.permissionBus,
    questionBus: config.questionBus,
    createMcpServer: config.createMcpServer,
    editTracker: config.editTracker,
    logsClient: config.logsClient,
    moduleRoots: config.moduleRoots,
    hostState: config.hostState,
    hostSocketRegistry: config.hostSocketRegistry,
    iframeSocketRegistry: config.iframeSocketRegistry,
    navigationCompleter: config.navigationCompleter,
    liveTurns: config.liveTurns,
    pendingQueue: config.pendingQueue,
    settingsStore: config.settingsStore,
  };
}
