import type { QueuedItemType } from "../protocol/messages.js";
import { MAX_QUEUED_MESSAGES } from "../protocol/messages.js";

export interface PendingQueueStore {
  enqueue: (conversationId: string, item: QueuedItemType) => void;
  cancel: (conversationId: string, id: string) => void;
  shift: (conversationId: string) => QueuedItemType | null;
  get: (conversationId: string) => QueuedItemType[];
  clear: (conversationId: string) => void;
  // Single-writer guard: exactly one drain runs per conversation. tryStartDrain
  // acquires it (false if a drain is already active); endDrain releases it. This
  // is what keeps the server the sole authority over dequeue — a reconnecting or
  // racing client can never start a parallel drain and double-run an item.
  tryStartDrain: (conversationId: string) => boolean;
  endDrain: (conversationId: string) => void;
}

// The server owns each conversation's follow-up queue in memory (session-scoped,
// no disk). Because the server is the only writer that dequeues, follow-ups
// survive a client reconnect/switch without being lost or run twice.
export function createPendingQueueStore(): PendingQueueStore {
  const byConversation = new Map<string, QueuedItemType[]>();
  const draining = new Set<string>();
  const itemsOf = (conversationId: string): QueuedItemType[] => {
    const existing = byConversation.get(conversationId);
    if (existing !== undefined) return existing;
    const created: QueuedItemType[] = [];
    byConversation.set(conversationId, created);
    return created;
  };
  return {
    enqueue: (conversationId, item) => {
      const items = itemsOf(conversationId);
      if (items.length >= MAX_QUEUED_MESSAGES) return;
      items.push(item);
    },
    cancel: (conversationId, id) => {
      const items = byConversation.get(conversationId);
      if (items === undefined) return;
      const next = items.filter((item) => item.id !== id);
      if (next.length === 0) byConversation.delete(conversationId);
      else byConversation.set(conversationId, next);
    },
    shift: (conversationId) => {
      const items = byConversation.get(conversationId);
      if (items === undefined || items.length === 0) return null;
      const [head] = items.splice(0, 1);
      if (items.length === 0) byConversation.delete(conversationId);
      return head ?? null;
    },
    get: (conversationId) => byConversation.get(conversationId) ?? [],
    clear: (conversationId) => {
      byConversation.delete(conversationId);
    },
    tryStartDrain: (conversationId) => {
      if (draining.has(conversationId)) return false;
      draining.add(conversationId);
      return true;
    },
    endDrain: (conversationId) => {
      draining.delete(conversationId);
    },
  };
}
