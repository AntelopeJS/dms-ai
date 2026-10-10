import type { WebSocket } from "ws";
import { WS_LOG_PREFIX } from "../constants/ws.js";
import { type AnyServerEventType, EVENT_TYPES } from "../protocol/events.js";
import {
  AnyClientMessage,
  type AnyClientMessageType,
  type ClientHelloMsgType,
  MESSAGE_TYPES,
  ROLE,
  type ServerEchoReplyMsgType,
  type SettingsPatchType,
} from "../protocol/messages.js";
import { mergeSettings, type SettingsStore } from "../state/settings-store.js";
import type { AppSettings } from "../state/settings-types.js";
import type { AgentRunner } from "../agent/runner.js";
import {
  broadcastConversationList,
  buildAskQuestionEvent,
  buildConversationListEvent,
  buildPermissionRequestEvent,
  buildSettingsUpdateEvent,
  buildSnapshotEvent,
  sendRulesState,
} from "./chat-events.js";
import type { ChatSocketRegistry } from "./chat-socket-registry.js";
import { handleChangeSetAction } from "./change-set-actions.js";
import { interruptConversation } from "./permission-events.js";
import type {
  ConnectionContext,
  RoutingConfig,
  SidecarServices,
} from "./services.js";
import {
  broadcastQueueState,
  buildQueueStateEvent,
  enqueueUserMessage,
  ensureDraining,
  lastUserMessage,
  logFailure,
  persistUserMessage,
  runExclusive,
  runUserTurn,
} from "./conversation-runs.js";

export type { ConnectionContext, RoutingConfig } from "./services.js";

type ClientMessageHandler = (
  socket: WebSocket,
  msg: AnyClientMessageType,
  ctx: ConnectionContext,
) => void | Promise<void>;

type MessageOf<T extends AnyClientMessageType["type"]> = Extract<
  AnyClientMessageType,
  { type: T }
>;

/** A handler bound to one message type: others never reach it. */
function on<T extends AnyClientMessageType["type"]>(
  type: T,
  handle: (
    socket: WebSocket,
    msg: MessageOf<T>,
    ctx: ConnectionContext,
  ) => void | Promise<void>,
): ClientMessageHandler {
  return (socket, msg, ctx) =>
    msg.type === type ? handle(socket, msg as MessageOf<T>, ctx) : undefined;
}

function send(socket: WebSocket, event: AnyServerEventType): void {
  socket.send(JSON.stringify(event));
}

function replayLiveTurn(
  socket: WebSocket,
  ctx: ConnectionContext,
  conversationId: string,
): void {
  const events = ctx.liveTurns.replay(conversationId);
  if (events === null) return;
  send(socket, { type: EVENT_TYPES.RUN_RESUMED, conversationId });
  for (const event of events) send(socket, event);
}

function sendConversationState(
  socket: WebSocket,
  ctx: ConnectionContext,
  conversationId: string,
): void {
  const snapshot = buildSnapshotEvent(ctx, conversationId);
  if (snapshot !== null) send(socket, snapshot);
  replayLiveTurn(socket, ctx, conversationId);
  // Always sent on re-attach, even when empty: the queue is the server's
  // authoritative state, so an empty payload must clear any stale client mirror
  // (e.g. follow-ups the server drained while the client was disconnected).
  send(socket, buildQueueStateEvent(ctx, conversationId));
  send(socket, {
    type: EVENT_TYPES.CONVERSATION_MODE,
    ...ctx.conversationModes.describe(conversationId),
  });
  send(socket, {
    type: EVENT_TYPES.RULES_STATE,
    conversationId,
    rules: ctx.permissionBus.listRules(conversationId),
  });
  for (const request of ctx.permissionBus.getPendingForConversation(
    conversationId,
  )) {
    send(socket, buildPermissionRequestEvent(request));
  }
  for (const question of ctx.questionBus.getPendingForConversation(
    conversationId,
  )) {
    send(socket, buildAskQuestionEvent(question));
  }
}

function sendSnapshotIfKnown(
  socket: WebSocket,
  ctx: ConnectionContext,
  msg: ClientHelloMsgType,
): void {
  if (msg.role !== ROLE.CHAT) return;
  send(socket, buildSettingsUpdateEvent(ctx));
  if (msg.conversationId === undefined) return;
  sendConversationState(socket, ctx, msg.conversationId);
}

function registerSocket(
  socket: WebSocket,
  msg: ClientHelloMsgType,
  ctx: ConnectionContext,
): void {
  if (msg.role === ROLE.HOST) {
    ctx.hostSocketRegistry.set(socket);
    return;
  }
  if (msg.conversationId === undefined) {
    ctx.chatSocketRegistry.addChat(socket);
    return;
  }
  if (msg.follow === true) {
    ctx.chatSocketRegistry.follow(msg.conversationId, socket);
    return;
  }
  ctx.chatSocketRegistry.set(msg.conversationId, socket);
}

const handleHello = on(MESSAGE_TYPES.HELLO, (socket, msg, ctx) => {
  console.log(`${WS_LOG_PREFIX} hello role=${msg.role}`);
  registerSocket(socket, msg, ctx);
  sendSnapshotIfKnown(socket, ctx, msg);
});

const handleEcho = on(MESSAGE_TYPES.ECHO, (socket, msg) => {
  const reply: ServerEchoReplyMsgType = {
    type: MESSAGE_TYPES.ECHO_REPLY,
    payload: msg.payload,
    serverTimeMs: Date.now(),
  };
  socket.send(JSON.stringify(reply));
});

const handleActor = on(MESSAGE_TYPES.ACTOR, (_socket, msg, ctx) => {
  ctx.actor = { userId: msg.userId, name: msg.name };
});

function noteAsker(ctx: ConnectionContext, conversationId: string): void {
  if (ctx.actor === null) return;
  ctx.askers.set(conversationId, ctx.actor.name);
}

const runUserMessage = on(MESSAGE_TYPES.USER_MESSAGE, async (_s, msg, ctx) => {
  noteAsker(ctx, msg.conversationId);
  // If a drain is already active (the client sent an immediate message while the
  // server still considers a run in flight), fold it into the queue so the one
  // active drain runs it — preserving ordering and the single-writer invariant.
  if (!ctx.pendingQueue.tryStartDrain(msg.conversationId)) {
    enqueueUserMessage(ctx, msg);
    void ensureDraining(ctx, msg.conversationId);
    return;
  }
  await runExclusive(ctx, msg.conversationId, async () => {
    persistUserMessage(ctx, msg.conversationId, msg);
    await runUserTurn(ctx, msg.conversationId, msg);
  });
});

// Re-runs the last request as it was typed; its attachments are not kept, so
// a retry carries the text alone.
const handleRetryTurn = on(MESSAGE_TYPES.RETRY_TURN, async (_s, msg, ctx) => {
  const last = lastUserMessage(ctx, msg.conversationId);
  if (last === undefined) return;
  if (!ctx.pendingQueue.tryStartDrain(msg.conversationId)) return;
  noteAsker(ctx, msg.conversationId);
  await runExclusive(ctx, msg.conversationId, () =>
    runUserTurn(ctx, msg.conversationId, { content: last.content }),
  );
});

const handleQueueEnqueue = on(MESSAGE_TYPES.QUEUE_ENQUEUE, (_s, msg, ctx) => {
  noteAsker(ctx, msg.conversationId);
  ctx.pendingQueue.enqueue(msg.conversationId, msg.item);
  broadcastQueueState(ctx, msg.conversationId);
  void ensureDraining(ctx, msg.conversationId);
});

const handleQueueCancel = on(MESSAGE_TYPES.QUEUE_CANCEL, (_s, msg, ctx) => {
  ctx.pendingQueue.cancel(msg.conversationId, msg.id);
  broadcastQueueState(ctx, msg.conversationId);
});

const handleQueueUpdate = on(MESSAGE_TYPES.QUEUE_UPDATE, (_s, msg, ctx) => {
  ctx.pendingQueue.update(msg.conversationId, msg.id, msg.content);
  broadcastQueueState(ctx, msg.conversationId);
});

const handleQueueMove = on(MESSAGE_TYPES.QUEUE_MOVE, (_s, msg, ctx) => {
  ctx.pendingQueue.move(msg.conversationId, msg.id, msg.toIndex);
  broadcastQueueState(ctx, msg.conversationId);
});

const handleQueueClear = on(MESSAGE_TYPES.QUEUE_CLEAR, (_s, msg, ctx) => {
  ctx.pendingQueue.clear(msg.conversationId);
  broadcastQueueState(ctx, msg.conversationId);
});

const handlePermissionResponse = on(
  MESSAGE_TYPES.PERMISSION_RESPONSE,
  (_s, msg, ctx) => {
    ctx.permissionBus.resolvePermission({
      requestId: msg.requestId,
      decision: msg.decision,
      rule: msg.rule,
      feedback: msg.feedback,
      keepData: msg.keepData,
      actor: ctx.actor?.name,
    });
  },
);

const handleRevokeRule = on(MESSAGE_TYPES.REVOKE_RULE, (_s, msg, ctx) => {
  if (ctx.permissionBus.revokeRule(msg.conversationId, msg.ruleId)) return;
  // Unknown id: the chat's list is stale, so send the real one.
  sendRulesState(ctx, msg.conversationId);
});

const handleQuestionResponse = on(
  MESSAGE_TYPES.QUESTION_RESPONSE,
  (_s, msg, ctx) => {
    ctx.questionBus.resolveQuestion(msg.requestId, {
      answers: msg.answers,
      skipped: msg.skipped ?? [],
    });
  },
);

// Unblock any tool the turn is paused on (awaiting permission or an answer),
// then signal the provider to wind the turn down; both are needed so the run
// can settle.
const handleInterruptTurn = on(MESSAGE_TYPES.INTERRUPT_TURN, (_s, msg, ctx) => {
  interruptConversation(ctx, msg.conversationId);
});

const handleStopAutoFix = on(MESSAGE_TYPES.STOP_AUTOFIX, (_s, msg, ctx) => {
  ctx.turns.stopAutoFix(msg.conversationId);
  if (ctx.turns.get(msg.conversationId)?.isAutoFix !== true) return;
  interruptConversation(ctx, msg.conversationId);
});

const handleSetConversationMode = on(
  MESSAGE_TYPES.SET_CONVERSATION_MODE,
  (_s, msg, ctx) => {
    ctx.conversationModes.update(msg.conversationId, {
      mode: msg.mode,
      generationMode: msg.generationMode,
      fullAuto: msg.fullAuto,
    });
  },
);

const handleLeaveConversation = on(
  MESSAGE_TYPES.LEAVE_CONVERSATION,
  (_s, msg, ctx) => {
    ctx.conversationModes.leave(msg.conversationId);
  },
);

const handleHostStateUpdate = on(
  MESSAGE_TYPES.HOST_STATE_UPDATE,
  async (_s, msg, ctx) => {
    await ctx.hostState.setCurrentPage(msg.currentPage);
  },
);

const handleHostNavigationComplete = on(
  MESSAGE_TYPES.HOST_NAVIGATION_COMPLETE,
  (_s, msg, ctx) => {
    ctx.navigationCompleter.complete(msg.path);
  },
);

const handleListConversations = on(
  MESSAGE_TYPES.LIST_CONVERSATIONS,
  (socket, _msg, ctx) => {
    send(socket, buildConversationListEvent(ctx));
  },
);

function forgetConversation(ctx: SidecarServices, conversationId: string) {
  ctx.conversationStore.delete(conversationId);
  ctx.permissionBus.forgetConversation(conversationId);
  ctx.questionBus.cancelConversation(conversationId);
  ctx.editTracker.clear(conversationId);
  ctx.conversationModes.forget(conversationId);
  ctx.callAudit.forget(conversationId);
  ctx.callLedger.forget(conversationId);
  ctx.askers.delete(conversationId);
  void ctx.runner.disposeSession(conversationId);
  ctx.liveTurns.end(conversationId);
  ctx.pendingQueue.clear(conversationId);
}

const handleDeleteConversation = on(
  MESSAGE_TYPES.DELETE_CONVERSATION,
  (socket, msg, ctx) => {
    forgetConversation(ctx, msg.conversationId);
    send(socket, buildConversationListEvent(ctx));
    broadcastConversationList(ctx);
  },
);

export interface SettingsApplyDeps {
  settingsStore: SettingsStore;
  runner: AgentRunner;
  chatSocketRegistry: ChatSocketRegistry;
}

// Single source of truth for applying a settings change, whether it arrives over
// the chat WS (mode bar) or the HTTP API (Settings admin page). Always
// broadcasts the new settings to every connected chat so both stay in sync.
export function applySettings(
  deps: SettingsApplyDeps,
  next: AppSettings,
): void {
  deps.settingsStore.set(next);
  deps.runner.applySettings(next);
  deps.chatSocketRegistry.broadcast(buildSettingsUpdateEvent(deps));
}

/** Merges a partial settings change over what is stored, then applies it. */
export function applySettingsPatch(
  deps: SettingsApplyDeps,
  patch: SettingsPatchType,
): AppSettings {
  const next = mergeSettings(deps.settingsStore.get(), patch);
  applySettings(deps, next);
  return next;
}

const handleSetSettings = on(MESSAGE_TYPES.SET_SETTINGS, (_s, msg, ctx) => {
  const { type: _type, ...patch } = msg;
  applySettingsPatch(ctx, patch);
});

const handleChangeSet = on(
  MESSAGE_TYPES.CHANGE_SET_ACTION,
  async (socket, msg, ctx) => {
    await handleChangeSetAction(ctx, msg, ctx.actor?.name).catch((err) => {
      logFailure("change set action failed", err);
      send(socket, {
        type: EVENT_TYPES.RUN_ERROR,
        conversationId: msg.conversationId ?? "",
        error: err instanceof Error ? err.message : String(err),
      });
    });
  },
);

const MESSAGE_HANDLERS: Record<string, ClientMessageHandler> = {
  [MESSAGE_TYPES.HELLO]: handleHello,
  [MESSAGE_TYPES.ECHO]: handleEcho,
  [MESSAGE_TYPES.ACTOR]: handleActor,
  [MESSAGE_TYPES.USER_MESSAGE]: runUserMessage,
  [MESSAGE_TYPES.RETRY_TURN]: handleRetryTurn,
  [MESSAGE_TYPES.PERMISSION_RESPONSE]: handlePermissionResponse,
  [MESSAGE_TYPES.REVOKE_RULE]: handleRevokeRule,
  [MESSAGE_TYPES.QUESTION_RESPONSE]: handleQuestionResponse,
  [MESSAGE_TYPES.INTERRUPT_TURN]: handleInterruptTurn,
  [MESSAGE_TYPES.STOP_AUTOFIX]: handleStopAutoFix,
  [MESSAGE_TYPES.SET_CONVERSATION_MODE]: handleSetConversationMode,
  [MESSAGE_TYPES.LEAVE_CONVERSATION]: handleLeaveConversation,
  [MESSAGE_TYPES.HOST_STATE_UPDATE]: handleHostStateUpdate,
  [MESSAGE_TYPES.HOST_NAVIGATION_COMPLETE]: handleHostNavigationComplete,
  [MESSAGE_TYPES.LIST_CONVERSATIONS]: handleListConversations,
  [MESSAGE_TYPES.DELETE_CONVERSATION]: handleDeleteConversation,
  [MESSAGE_TYPES.SET_SETTINGS]: handleSetSettings,
  [MESSAGE_TYPES.QUEUE_ENQUEUE]: handleQueueEnqueue,
  [MESSAGE_TYPES.QUEUE_CANCEL]: handleQueueCancel,
  [MESSAGE_TYPES.QUEUE_UPDATE]: handleQueueUpdate,
  [MESSAGE_TYPES.QUEUE_MOVE]: handleQueueMove,
  [MESSAGE_TYPES.QUEUE_CLEAR]: handleQueueClear,
  [MESSAGE_TYPES.CHANGE_SET_ACTION]: handleChangeSet,
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
    console.warn(`${WS_LOG_PREFIX} invalid message`);
    return;
  }
  const handler = MESSAGE_HANDLERS[msg.type];
  if (handler === undefined) return;
  void handler(socket, msg, ctx);
}

/** A connection's context: the shared services, and no actor until told. */
export function buildConnectionContext(
  config: RoutingConfig,
): ConnectionContext {
  return { ...config, actor: null };
}
