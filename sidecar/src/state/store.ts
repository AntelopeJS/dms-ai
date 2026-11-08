import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  STATE_DEBOUNCE_MS,
  STATE_FILE_ENCODING,
  STATE_INITIAL,
  STATE_JSON_INDENT,
  STATE_LOG_PREFIX,
} from "../constants/state.js";
import { migrateConversation } from "./legacy-tool-names.js";
import { StoredConversationSchema } from "./stored-schemas.js";
import type { StoredState } from "./types.js";

export interface CreateStoreOptions {
  filePath: string;
  debounceMs?: number;
}

export interface Store {
  read(): Promise<StoredState>;
  write(state: StoredState): void;
  flush(): Promise<void>;
}

interface StoreState {
  filePath: string;
  debounceMs: number;
  pending: StoredState | null;
  timer: NodeJS.Timeout | null;
  inflight: Promise<void> | null;
}

const StateFileSchema = z.object({
  conversations: z.record(z.string(), z.unknown()),
});

type StateFile = z.infer<typeof StateFileSchema>;

function readConversations(
  stored: StateFile["conversations"],
): StoredState["conversations"] {
  const entries = Object.entries(stored);
  const kept = entries.flatMap(([id, entry]) => {
    const parsed = StoredConversationSchema.safeParse(entry);
    return parsed.success
      ? [[id, migrateConversation(parsed.data)] as const]
      : [];
  });
  const dropped = entries.length - kept.length;
  if (dropped > 0) {
    console.warn(
      `${STATE_LOG_PREFIX} dropped ${dropped} stored conversation(s) of another shape`,
    );
  }
  return Object.fromEntries(kept);
}

function parseStateContents(raw: string): StoredState {
  try {
    const parsed = StateFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return STATE_INITIAL;
    return { conversations: readConversations(parsed.data.conversations) };
  } catch {
    return STATE_INITIAL;
  }
}

async function readState(filePath: string): Promise<StoredState> {
  try {
    const raw = await readFile(filePath, STATE_FILE_ENCODING);
    return parseStateContents(raw);
  } catch (err) {
    const isMissing =
      err instanceof Error && "code" in err && err.code === "ENOENT";
    if (isMissing) return STATE_INITIAL;
    console.warn(`${STATE_LOG_PREFIX} read failed: ${String(err)}`);
    return STATE_INITIAL;
  }
}

async function persistState(
  filePath: string,
  state: StoredState,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const json = JSON.stringify(state, null, STATE_JSON_INDENT);
  await writeFile(filePath, json, STATE_FILE_ENCODING);
}

function clearTimer(state: StoreState): void {
  if (state.timer === null) return;
  clearTimeout(state.timer);
  state.timer = null;
}

async function drainPending(state: StoreState): Promise<void> {
  const next = state.pending;
  if (next === null) return;
  state.pending = null;
  try {
    await persistState(state.filePath, next);
  } catch (err) {
    console.warn(`${STATE_LOG_PREFIX} write failed: ${String(err)}`);
  }
}

function scheduleWrite(state: StoreState): void {
  clearTimer(state);
  state.timer = setTimeout(() => {
    state.timer = null;
    state.inflight = drainPending(state);
  }, state.debounceMs);
}

function enqueueWrite(state: StoreState, next: StoredState): void {
  state.pending = next;
  scheduleWrite(state);
}

async function flushStore(state: StoreState): Promise<void> {
  clearTimer(state);
  if (state.inflight !== null) await state.inflight;
  state.inflight = drainPending(state);
  await state.inflight;
  state.inflight = null;
}

export function createStore(options: CreateStoreOptions): Store {
  const state: StoreState = {
    filePath: options.filePath,
    debounceMs: options.debounceMs ?? STATE_DEBOUNCE_MS,
    pending: null,
    timer: null,
    inflight: null,
  };
  return {
    read: () => readState(state.filePath),
    write: (next) => enqueueWrite(state, next),
    flush: () => flushStore(state),
  };
}
