import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { CHECKPOINTS_LOG_PREFIX } from "../constants/checkpoints.js";
import { STATE_FILE_ENCODING, STATE_JSON_INDENT } from "../constants/state.js";
import { ChangeSetRecordSchema } from "./stored-schemas.js";
import type { ChangeSetRecord } from "./types.js";

const FIRST_CHANGE_SET_NUMBER = 1;

interface ChangeSetFileContents {
  nextNumber: number;
  changeSets: ChangeSetRecord[];
}

/** Every recorded change set, oldest first, persisted next to the transcripts. */
export interface ChangeSetStore {
  load(): Promise<void>;
  all(): ChangeSetRecord[];
  get(id: string): ChangeSetRecord | null;
  nextNumber(): number;
  add(record: ChangeSetRecord): void;
  update(id: string, patch: Partial<ChangeSetRecord>): ChangeSetRecord | null;
  remove(ids: readonly string[]): void;
  flush(): Promise<void>;
}

interface StoreState {
  filePath: string;
  contents: ChangeSetFileContents;
  /** The stored records this version cannot read, written back as they were. */
  unreadable: unknown[];
  inflight: Promise<void>;
}

/** A change-set file as read: what this version uses, and the records it keeps aside. */
interface ReadChangeSetFile {
  contents: ChangeSetFileContents;
  unreadable: unknown[];
}

function nothingRead(): ReadChangeSetFile {
  return {
    contents: { nextNumber: FIRST_CHANGE_SET_NUMBER, changeSets: [] },
    unreadable: [],
  };
}

const ChangeSetFileSchema = z.object({
  nextNumber: z.number().optional().catch(undefined),
  changeSets: z.array(z.unknown()),
});

function parseContents(raw: string): ReadChangeSetFile {
  try {
    const parsed = ChangeSetFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return nothingRead();
    const changeSets: ChangeSetRecord[] = [];
    const unreadable: unknown[] = [];
    for (const entry of parsed.data.changeSets) {
      const record = ChangeSetRecordSchema.safeParse(entry);
      if (record.success) changeSets.push(record.data);
      else unreadable.push(entry);
    }
    if (unreadable.length > 0) {
      console.warn(
        `${CHECKPOINTS_LOG_PREFIX} set aside ${unreadable.length} stored change set(s) of another shape`,
      );
    }
    const nextNumber =
      parsed.data.nextNumber ??
      parsed.data.changeSets.length + FIRST_CHANGE_SET_NUMBER;
    return { contents: { nextNumber, changeSets }, unreadable };
  } catch {
    return nothingRead();
  }
}

async function readContents(filePath: string): Promise<ReadChangeSetFile> {
  try {
    return parseContents(await readFile(filePath, STATE_FILE_ENCODING));
  } catch {
    return nothingRead();
  }
}

/** Queues the write behind the previous one so two quick changes land in order. */
function persist(state: StoreState): void {
  const { nextNumber, changeSets } = state.contents;
  const json = JSON.stringify(
    { nextNumber, changeSets: [...changeSets, ...state.unreadable] },
    null,
    STATE_JSON_INDENT,
  );
  state.inflight = state.inflight
    .then(async () => {
      await mkdir(dirname(state.filePath), { recursive: true });
      await writeFile(state.filePath, json, STATE_FILE_ENCODING);
    })
    .catch((err: unknown) => {
      console.warn(`${CHECKPOINTS_LOG_PREFIX} write failed: ${String(err)}`);
    });
}

export function createChangeSetStore(filePath: string): ChangeSetStore {
  const state: StoreState = {
    filePath,
    ...nothingRead(),
    inflight: Promise.resolve(),
  };
  return {
    load: async () => {
      const read = await readContents(filePath);
      state.contents = read.contents;
      state.unreadable = read.unreadable;
    },
    all: () => [...state.contents.changeSets],
    get: (id) => state.contents.changeSets.find((c) => c.id === id) ?? null,
    nextNumber: () => state.contents.nextNumber,
    add(record) {
      state.contents.changeSets.push(record);
      state.contents.nextNumber = record.number + 1;
      persist(state);
    },
    update(id, patch) {
      const record = state.contents.changeSets.find((c) => c.id === id);
      if (record === undefined) return null;
      Object.assign(record, patch);
      persist(state);
      return record;
    },
    remove(ids) {
      state.contents.changeSets = state.contents.changeSets.filter(
        (c) => !ids.includes(c.id),
      );
      persist(state);
    },
    flush: () => state.inflight,
  };
}
