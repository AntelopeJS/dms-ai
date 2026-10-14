import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CHECKPOINTS_LOG_PREFIX } from "../constants/checkpoints.js";
import { STATE_FILE_ENCODING, STATE_JSON_INDENT } from "../constants/state.js";
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
  inflight: Promise<void>;
}

function emptyContents(): ChangeSetFileContents {
  return { nextNumber: FIRST_CHANGE_SET_NUMBER, changeSets: [] };
}

function parseContents(raw: string): ChangeSetFileContents {
  try {
    const parsed = JSON.parse(raw) as Partial<ChangeSetFileContents>;
    if (!Array.isArray(parsed.changeSets)) return emptyContents();
    return {
      nextNumber:
        typeof parsed.nextNumber === "number"
          ? parsed.nextNumber
          : parsed.changeSets.length + FIRST_CHANGE_SET_NUMBER,
      changeSets: parsed.changeSets,
    };
  } catch {
    return emptyContents();
  }
}

async function readContents(filePath: string): Promise<ChangeSetFileContents> {
  try {
    return parseContents(await readFile(filePath, STATE_FILE_ENCODING));
  } catch {
    return emptyContents();
  }
}

// Writes are chained so two quick changes land in order.
function persist(state: StoreState): void {
  const json = JSON.stringify(state.contents, null, STATE_JSON_INDENT);
  state.inflight = state.inflight
    .then(async () => {
      await mkdir(dirname(state.filePath), { recursive: true });
      await writeFile(state.filePath, json, STATE_FILE_ENCODING);
    })
    .catch((err) => {
      console.warn(`${CHECKPOINTS_LOG_PREFIX} write failed: ${String(err)}`);
    });
}

export function createChangeSetStore(filePath: string): ChangeSetStore {
  const state: StoreState = {
    filePath,
    contents: emptyContents(),
    inflight: Promise.resolve(),
  };
  return {
    load: async () => {
      state.contents = await readContents(filePath);
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
