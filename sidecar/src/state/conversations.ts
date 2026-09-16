import type { Store } from "./store.js";
import type {
  ConversationSummary,
  StoredConversation,
  StoredMessage,
} from "./types.js";

export interface CreateConversationStoreOptions {
  store: Store;
}

export interface ConversationStore {
  get(conversationId: string): StoredConversation | null;
  getOrCreate(conversationId: string): StoredConversation;
  appendMessage(conversationId: string, message: StoredMessage): void;
  list(): ConversationSummary[];
  entries(): Array<{
    id: string;
    title: string;
    conversation: StoredConversation;
  }>;
  delete(conversationId: string): void;
  loadFromDisk(): Promise<void>;
  flush(): Promise<void>;
}

const TITLE_MAX_LENGTH = 60;
const TITLE_FALLBACK = "New conversation";

interface CacheState {
  store: Store;
  cache: Map<string, StoredConversation>;
}

function buildEmptyConversation(nowMs: number): StoredConversation {
  return {
    messages: [],
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

function snapshotState(state: CacheState): {
  conversations: Record<string, StoredConversation>;
} {
  return { conversations: Object.fromEntries(state.cache) };
}

function persistCache(state: CacheState): void {
  state.store.write(snapshotState(state));
}

function getConversation(
  state: CacheState,
  conversationId: string,
): StoredConversation | null {
  return state.cache.get(conversationId) ?? null;
}

function ensureConversation(
  state: CacheState,
  conversationId: string,
): StoredConversation {
  const existing = state.cache.get(conversationId);
  if (existing !== undefined) return existing;
  const created = buildEmptyConversation(Date.now());
  state.cache.set(conversationId, created);
  return created;
}

function appendToConversation(
  state: CacheState,
  conversationId: string,
  message: StoredMessage,
): void {
  const conversation = ensureConversation(state, conversationId);
  conversation.messages.push(message);
  conversation.updatedAtMs = message.timestampMs;
  persistCache(state);
}

function deriveTitle(conversation: StoredConversation): string {
  const firstUser = conversation.messages.find((m) => m.role === "user");
  if (firstUser === undefined) return TITLE_FALLBACK;
  const text = firstUser.content.trim();
  if (text.length === 0) return TITLE_FALLBACK;
  if (text.length <= TITLE_MAX_LENGTH) return text;
  return `${text.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`;
}

function listConversations(state: CacheState): ConversationSummary[] {
  const summaries: ConversationSummary[] = [];
  for (const [id, conversation] of state.cache) {
    summaries.push({
      id,
      title: deriveTitle(conversation),
      createdAtMs: conversation.createdAtMs,
      updatedAtMs: conversation.updatedAtMs,
      messageCount: conversation.messages.length,
    });
  }
  summaries.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return summaries;
}

function listEntries(
  state: CacheState,
): Array<{ id: string; title: string; conversation: StoredConversation }> {
  const entries: Array<{
    id: string;
    title: string;
    conversation: StoredConversation;
  }> = [];
  for (const [id, conversation] of state.cache) {
    entries.push({ id, title: deriveTitle(conversation), conversation });
  }
  return entries;
}

function deleteConversation(state: CacheState, conversationId: string): void {
  if (!state.cache.delete(conversationId)) return;
  persistCache(state);
}

async function loadCacheFromDisk(state: CacheState): Promise<void> {
  const stored = await state.store.read();
  state.cache.clear();
  for (const [id, conv] of Object.entries(stored.conversations)) {
    state.cache.set(id, conv);
  }
}

export function createConversationStore(
  options: CreateConversationStoreOptions,
): ConversationStore {
  const state: CacheState = {
    store: options.store,
    cache: new Map(),
  };
  return {
    get: (id) => getConversation(state, id),
    getOrCreate: (id) => ensureConversation(state, id),
    appendMessage: (id, message) => appendToConversation(state, id, message),
    list: () => listConversations(state),
    entries: () => listEntries(state),
    delete: (id) => deleteConversation(state, id),
    loadFromDisk: () => loadCacheFromDisk(state),
    flush: () => state.store.flush(),
  };
}
