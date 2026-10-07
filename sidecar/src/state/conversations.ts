import type { Store } from "./store.js";
import type { ChatMode, GenerationMode } from "./settings-types.js";
import {
  EMPTY_TOKEN_USAGE,
  type ProviderName,
  type StoredConversation,
  type StoredConversationSummary,
  type StoredMessage,
  type TokenUsage,
} from "./types.js";

export interface CreateConversationStoreOptions {
  store: Store;
}

export interface ConversationEntry {
  id: string;
  title: string;
  conversation: StoredConversation;
}

/** The per-conversation approval mode and scope, both optional on update. */
export interface ConversationModesPatch {
  mode?: ChatMode;
  generationMode?: GenerationMode;
}

export type StoredMessagePatch = Partial<StoredMessage>;

export interface ConversationStore {
  get(conversationId: string): StoredConversation | null;
  getOrCreate(conversationId: string): StoredConversation;
  appendMessage(conversationId: string, message: StoredMessage): void;
  /**
   * Merges `patch` into every stored message `matches` accepts. Used to stamp
   * an outcome or a change set on calls already persisted.
   */
  patchMessages(
    conversationId: string,
    matches: (message: StoredMessage) => boolean,
    patch: StoredMessagePatch,
  ): void;
  /** Records which backend produced the transcript. */
  markProvider(conversationId: string, provider: ProviderName): void;
  /** Adds one turn's usage to the conversation total. */
  addTokenUsage(conversationId: string, usage: TokenUsage): void;
  /** Adds one turn's usage to the total and to the dated usage log. */
  recordTurnUsage(
    conversationId: string,
    usage: TokenUsage,
    timestampMs: number,
  ): void;
  setModes(conversationId: string, patch: ConversationModesPatch): void;
  list(): StoredConversationSummary[];
  entries(): ConversationEntry[];
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

function patchMessages(
  state: CacheState,
  conversationId: string,
  matches: (message: StoredMessage) => boolean,
  patch: StoredMessagePatch,
): void {
  const conversation = state.cache.get(conversationId);
  if (conversation === undefined) return;
  let isChanged = false;
  for (const message of conversation.messages) {
    if (!matches(message)) continue;
    Object.assign(message, patch);
    isChanged = true;
  }
  if (isChanged) persistCache(state);
}

function markProvider(
  state: CacheState,
  conversationId: string,
  provider: ProviderName,
): void {
  const conversation = ensureConversation(state, conversationId);
  if (conversation.provider === provider) return;
  conversation.provider = provider;
  persistCache(state);
}

function sumUsage(current: TokenUsage, usage: TokenUsage): TokenUsage {
  return {
    inputTokens: current.inputTokens + usage.inputTokens,
    outputTokens: current.outputTokens + usage.outputTokens,
    totalTokens: current.totalTokens + usage.totalTokens,
  };
}

function addTokenUsage(
  state: CacheState,
  conversationId: string,
  usage: TokenUsage,
): void {
  const conversation = ensureConversation(state, conversationId);
  conversation.tokenUsage = sumUsage(
    conversation.tokenUsage ?? EMPTY_TOKEN_USAGE,
    usage,
  );
  persistCache(state);
}

function recordTurnUsage(
  state: CacheState,
  conversationId: string,
  usage: TokenUsage,
  timestampMs: number,
): void {
  const conversation = ensureConversation(state, conversationId);
  conversation.usageLog = [
    ...(conversation.usageLog ?? []),
    { ...usage, timestampMs },
  ];
  addTokenUsage(state, conversationId, usage);
}

function setModes(
  state: CacheState,
  conversationId: string,
  patch: ConversationModesPatch,
): void {
  const conversation = ensureConversation(state, conversationId);
  if (patch.mode !== undefined) conversation.mode = patch.mode;
  if (patch.generationMode !== undefined) {
    conversation.generationMode = patch.generationMode;
  }
  persistCache(state);
}

export function deriveTitle(conversation: StoredConversation): string {
  const firstUser = conversation.messages.find((m) => m.role === "user");
  if (firstUser === undefined) return TITLE_FALLBACK;
  return truncateTitle(firstUser.content);
}

/** A request shortened to a title: one line, at most TITLE_MAX_LENGTH chars. */
export function truncateTitle(content: string): string {
  const text = content.trim().replaceAll(/\s+/g, " ");
  if (text.length === 0) return TITLE_FALLBACK;
  if (text.length <= TITLE_MAX_LENGTH) return text;
  return `${text.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`;
}

function summarize(
  id: string,
  conversation: StoredConversation,
): StoredConversationSummary {
  return {
    id,
    title: deriveTitle(conversation),
    createdAtMs: conversation.createdAtMs,
    updatedAtMs: conversation.updatedAtMs,
    messageCount: conversation.messages.length,
    provider: conversation.provider,
    totalTokens: conversation.tokenUsage?.totalTokens ?? 0,
  };
}

function listConversations(state: CacheState): StoredConversationSummary[] {
  const summaries = [...state.cache].map(([id, conversation]) =>
    summarize(id, conversation),
  );
  summaries.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return summaries;
}

function listEntries(state: CacheState): ConversationEntry[] {
  return [...state.cache].map(([id, conversation]) => ({
    id,
    title: deriveTitle(conversation),
    conversation,
  }));
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
    patchMessages: (id, matches, patch) =>
      patchMessages(state, id, matches, patch),
    markProvider: (id, provider) => markProvider(state, id, provider),
    addTokenUsage: (id, usage) => addTokenUsage(state, id, usage),
    recordTurnUsage: (id, usage, timestampMs) =>
      recordTurnUsage(state, id, usage, timestampMs),
    setModes: (id, patch) => setModes(state, id, patch),
    list: () => listConversations(state),
    entries: () => listEntries(state),
    delete: (id) => deleteConversation(state, id),
    loadFromDisk: () => loadCacheFromDisk(state),
    flush: () => state.store.flush(),
  };
}
