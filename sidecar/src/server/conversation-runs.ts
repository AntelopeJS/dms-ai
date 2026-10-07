import { randomUUID } from "node:crypto";
import { WS_LOG_PREFIX } from "../constants/ws.js";
import {
  EVENT_TYPES,
  type QueueStateEventType,
  type UserMessageEchoEventType,
} from "../protocol/events.js";
import type {
  AttachmentType,
  QueuedItemType,
  UserMessageMsgType,
} from "../protocol/messages.js";
import type { StoredMessage } from "../state/types.js";
import type { SidecarServices } from "./services.js";
import { runTurnWithHealing } from "./turns.js";

export function buildQueueStateEvent(
  services: SidecarServices,
  conversationId: string,
): QueueStateEventType {
  return {
    type: EVENT_TYPES.QUEUE_STATE,
    conversationId,
    items: services.pendingQueue.get(conversationId),
  };
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

export function persistUserMessage(
  ctx: SidecarServices,
  conversationId: string,
  item: Pick<QueuedItemType, "content" | "attachments">,
): void {
  ctx.conversationStore.appendMessage(conversationId, {
    role: "user",
    content: item.content,
    attachments: toStoredAttachmentMeta(item.attachments ?? []),
    timestampMs: Date.now(),
  });
}

export function runUserTurn(
  services: SidecarServices,
  conversationId: string,
  item: Pick<QueuedItemType, "content" | "attachments">,
): Promise<void> {
  return runTurnWithHealing(services, {
    conversationId,
    content: item.content,
    request: item.content,
    attachments: item.attachments,
    isAutoFix: false,
  });
}

function sendUserEcho(
  ctx: SidecarServices,
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
  ctx.chatSocketRegistry.send(conversationId, event);
}

export function broadcastQueueState(
  ctx: SidecarServices,
  conversationId: string,
): void {
  ctx.chatSocketRegistry.send(
    conversationId,
    buildQueueStateEvent(ctx, conversationId),
  );
}

export function logFailure(what: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`${WS_LOG_PREFIX} ${what}: ${message}`);
}

// Server-owned dequeue: run queued follow-ups one at a time until the queue is
// empty. The caller holds the per-conversation drain lock, so this is the sole
// writer that consumes items — a client reconnect can restore the queue but can
// never resurrect an item already dequeued here, nor run one twice.
async function drainConversation(
  ctx: SidecarServices,
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
      persistUserMessage(ctx, conversationId, next);
      sendUserEcho(ctx, conversationId, next);
      await runUserTurn(ctx, conversationId, next);
    } catch (err) {
      logFailure("queued turn failed", err);
    }
  }
}

// Start draining if no drain is already active for this conversation. Called
// whenever the queue may have gained work while idle (an enqueue that races a
// finishing drain); the lock makes concurrent calls no-ops.
export async function ensureDraining(
  ctx: SidecarServices,
  conversationId: string,
): Promise<void> {
  if (!ctx.pendingQueue.tryStartDrain(conversationId)) return;
  try {
    await drainConversation(ctx, conversationId);
  } catch (err) {
    logFailure("drain failed", err);
  } finally {
    ctx.pendingQueue.endDrain(conversationId);
  }
}

export function enqueueUserMessage(
  ctx: SidecarServices,
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

/** Runs one turn under the drain lock, then whatever was queued meanwhile. */
export async function runExclusive(
  ctx: SidecarServices,
  conversationId: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
    await drainConversation(ctx, conversationId);
  } catch (err) {
    logFailure("run failed", err);
  } finally {
    ctx.pendingQueue.endDrain(conversationId);
  }
}

export function lastUserMessage(
  ctx: SidecarServices,
  conversationId: string,
): StoredMessage | undefined {
  const messages = ctx.conversationStore.get(conversationId)?.messages ?? [];
  return [...messages].reverse().find((m) => m.role === "user");
}
