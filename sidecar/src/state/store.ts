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

const StateFileSchema = z.object({
  conversations: z.record(z.string(), z.unknown()),
});

type StoredEntries = z.infer<typeof StateFileSchema>["conversations"];

interface StoreState {
  filePath: string;
  debounceMs: number;
  pending: StoredState | null;
  timer: NodeJS.Timeout | null;
  inflight: Promise<void> | null;
  /** The stored conversations this version cannot read, written back as they were. */
  unreadable: StoredEntries;
}

/** A state file as read: what this version uses, and the entries it keeps aside. */
interface ReadStateFile {
  state: StoredState;
  unreadable: StoredEntries;
}

const NOTHING_READ: ReadStateFile = { state: STATE_INITIAL, unreadable: {} };

function readConversations(stored: StoredEntries): ReadStateFile {
  const conversations: StoredState["conversations"] = {};
  const unreadable: StoredEntries = {};
  for (const [id, entry] of Object.entries(stored)) {
    const parsed = StoredConversationSchema.safeParse(entry);
    if (parsed.success) conversations[id] = migrateConversation(parsed.data);
    else unreadable[id] = entry;
  }
  const dropped = Object.keys(unreadable).length;
  if (dropped > 0) {
    console.warn(
      `${STATE_LOG_PREFIX} set aside ${dropped} stored conversation(s) of another shape`,
    );
  }
  return { state: { conversations }, unreadable };
}

function parseStateContents(raw: string): ReadStateFile {
  try {
    const parsed = StateFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return NOTHING_READ;
    return readConversations(parsed.data.conversations);
  } catch {
    return NOTHING_READ;
  }
}

async function readStateFile(filePath: string): Promise<ReadStateFile> {
  try {
    const raw = await readFile(filePath, STATE_FILE_ENCODING);
    return parseStateContents(raw);
  } catch (err) {
    const isMissing =
      err instanceof Error && "code" in err && err.code === "ENOENT";
    if (isMissing) return NOTHING_READ;
    console.warn(`${STATE_LOG_PREFIX} read failed: ${String(err)}`);
    return NOTHING_READ;
  }
}

async function readState(state: StoreState): Promise<StoredState> {
  const read = await readStateFile(state.filePath);
  state.unreadable = read.unreadable;
  return read.state;
}

async function persistState(
  state: StoreState,
  next: StoredState,
): Promise<void> {
  await mkdir(dirname(state.filePath), { recursive: true });
  const conversations = { ...state.unreadable, ...next.conversations };
  const json = JSON.stringify({ conversations }, null, STATE_JSON_INDENT);
  await writeFile(state.filePath, json, STATE_FILE_ENCODING);
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
    await persistState(state, next);
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
    unreadable: {},
  };
  return {
    read: () => readState(state),
    write: (next) => enqueueWrite(state, next),
    flush: () => flushStore(state),
  };
}
