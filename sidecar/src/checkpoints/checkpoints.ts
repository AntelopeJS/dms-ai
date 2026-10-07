import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseUnifiedDiff } from "../agent/line-diff.js";
import type { ChangeSetState, TypecheckOutcome } from "../constants/audit.js";
import {
  CHECKPOINTS_LOG_PREFIX,
  MS_PER_DAY,
} from "../constants/checkpoints.js";
import type { DiffHunkType } from "../protocol/events.js";
import type { ChangeSetStore } from "../state/change-sets.js";
import type { GenerationMode } from "../state/settings-types.js";
import type {
  ChangeSetFile,
  ChangeSetRecord,
  ChangeSetSummary,
  ProviderName,
} from "../state/types.js";
import type { ShadowGit } from "./shadow-git.js";

/** Everything a change set records besides the files, known at turn end. */
export interface TurnChangeMeta {
  conversationId: string;
  title: string;
  agent: ProviderName;
  scope: GenerationMode;
  isAutoFix: boolean;
  askedBy?: string;
  approvalsNeeded: number;
  builderOps: number;
  typecheck: TypecheckOutcome;
  pagePath?: string;
}

/** One turn's window on the work tree. */
export interface TurnCheckpoint {
  /** Resolves once the "before" snapshot exists; mutating tools await it. */
  ready(): Promise<void>;
  /** Snapshots again and records the difference, or nothing if none. */
  finish(meta: TurnChangeMeta): Promise<ChangeSetRecord | null>;
}

export interface ChangeSetFileDetail extends ChangeSetFile {
  hunks: DiffHunkType[];
  isBinary: boolean;
}

export interface UndoConflict {
  changeSetId: string;
  number: number;
  title: string;
  files: string[];
}

export interface UndoPreview {
  changeSetId: string;
  files: string[];
  conflicts: UndoConflict[];
}

export const CHANGE_SET_ERRORS = {
  NOT_FOUND: "not_found",
  WRONG_STATE: "wrong_state",
  UNAVAILABLE: "unavailable",
} as const;
export type ChangeSetErrorCode =
  (typeof CHANGE_SET_ERRORS)[keyof typeof CHANGE_SET_ERRORS];

export class ChangeSetActionError extends Error {
  constructor(
    readonly code: ChangeSetErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface Checkpoints {
  isAvailable(): boolean;
  /** Finds git, prepares the shadow repository and prunes old change sets. */
  start(retentionDays: number): Promise<void>;
  beginTurn(conversationId: string): TurnCheckpoint;
  all(): ChangeSetRecord[];
  get(id: string): ChangeSetRecord | null;
  forConversation(conversationId: string): ChangeSetSummary[];
  fileDetails(id: string): Promise<ChangeSetFileDetail[]>;
  undoPreview(id: string): UndoPreview;
  undo(
    id: string,
    includeLater: boolean,
    actor?: string,
  ): Promise<ChangeSetRecord[]>;
  redo(id: string, actor?: string): Promise<ChangeSetRecord[]>;
  setTypecheck(id: string, outcome: TypecheckOutcome): ChangeSetRecord | null;
  /** Resolves once every change set is written to disk. */
  flush(): Promise<void>;
}

export interface CheckpointsDeps {
  git: ShadowGit;
  store: ChangeSetStore;
}

interface RunningTurn {
  isOverlapped: boolean;
}

interface CheckpointsState extends CheckpointsDeps {
  isAvailable: boolean;
  lock: Promise<unknown>;
  running: Set<RunningTurn>;
}

const NO_OP_CHECKPOINT: TurnCheckpoint = {
  ready: () => Promise.resolve(),
  finish: () => Promise.resolve(null),
};

// Snapshots share one shadow index, so they run one at a time.
function serialize<T>(
  state: CheckpointsState,
  task: () => Promise<T>,
): Promise<T> {
  const run = state.lock.then(task, task);
  state.lock = run.catch(() => undefined);
  return run;
}

export function toSummary(record: ChangeSetRecord): ChangeSetSummary {
  const {
    beforeTree: _before,
    afterTree: _after,
    pagePath: _page,
    stateLog: _log,
    ...summary
  } = record;
  return summary;
}

function sum(files: ChangeSetFile[], key: "added" | "removed"): number {
  return files.reduce((total, file) => total + file[key], 0);
}

function buildRecord(
  state: CheckpointsState,
  meta: TurnChangeMeta,
  trees: [string, string],
  files: ChangeSetFile[],
  isOverlapped: boolean,
): ChangeSetRecord {
  return {
    id: randomUUID(),
    number: state.store.nextNumber(),
    ...meta,
    createdAtMs: Date.now(),
    overlapped: isOverlapped,
    files,
    added: sum(files, "added"),
    removed: sum(files, "removed"),
    state: "applied",
    beforeTree: trees[0],
    afterTree: trees[1],
  };
}

async function recordTurn(
  state: CheckpointsState,
  before: string,
  meta: TurnChangeMeta,
  turn: RunningTurn,
): Promise<ChangeSetRecord | null> {
  const after = await serialize(state, () => state.git.snapshot());
  const files = await state.git.changedFiles(before, after);
  if (files.length === 0) return null;
  const record = buildRecord(
    state,
    meta,
    [before, after],
    files,
    turn.isOverlapped,
  );
  await state.git.keep(record.id, before, after);
  state.store.add(record);
  return record;
}

function markOverlaps(state: CheckpointsState, turn: RunningTurn): void {
  if (state.running.size === 0) return;
  turn.isOverlapped = true;
  for (const other of state.running) other.isOverlapped = true;
}

function beginTurn(state: CheckpointsState): TurnCheckpoint {
  if (!state.isAvailable) return NO_OP_CHECKPOINT;
  const turn: RunningTurn = { isOverlapped: false };
  markOverlaps(state, turn);
  state.running.add(turn);
  const before = serialize(state, () => state.git.snapshot());
  before.catch(() => undefined);
  return {
    ready: () =>
      before.then(
        () => undefined,
        () => undefined,
      ),
    finish: async (meta) => {
      try {
        return await recordTurn(state, await before, meta, turn);
      } catch (err) {
        console.warn(
          `${CHECKPOINTS_LOG_PREFIX} snapshot failed: ${String(err)}`,
        );
        return null;
      } finally {
        state.running.delete(turn);
      }
    },
  };
}

function requireRecord(state: CheckpointsState, id: string): ChangeSetRecord {
  const record = state.store.get(id);
  if (record === null) {
    throw new ChangeSetActionError(
      CHANGE_SET_ERRORS.NOT_FOUND,
      "Unknown change set.",
    );
  }
  return record;
}

function requireState(record: ChangeSetRecord, expected: ChangeSetState): void {
  if (record.state === expected) return;
  throw new ChangeSetActionError(
    CHANGE_SET_ERRORS.WRONG_STATE,
    `Change set #${record.number} is already ${record.state}.`,
  );
}

function pathsOf(record: ChangeSetRecord): string[] {
  return record.files.map((file) => file.path);
}

/** Later change sets, still applied, that touch a file of this one. */
function laterConflicts(
  state: CheckpointsState,
  record: ChangeSetRecord,
): ChangeSetRecord[] {
  const files = new Set(pathsOf(record));
  return state.store
    .all()
    .filter(
      (other) =>
        other.number > record.number &&
        other.state === "applied" &&
        other.files.some((file) => files.has(file.path)),
    )
    .sort((a, b) => b.number - a.number);
}

function undoPreview(state: CheckpointsState, id: string): UndoPreview {
  const record = requireRecord(state, id);
  const files = new Set(pathsOf(record));
  return {
    changeSetId: id,
    files: pathsOf(record),
    conflicts: laterConflicts(state, record).map((other) => ({
      changeSetId: other.id,
      number: other.number,
      title: other.title,
      files: pathsOf(other).filter((file) => files.has(file)),
    })),
  };
}

function markState(
  state: CheckpointsState,
  record: ChangeSetRecord,
  next: ChangeSetState,
  actor: string | undefined,
): ChangeSetRecord {
  const atMs = Date.now();
  const change = { state: next, atMs, by: actor };
  return (
    state.store.update(record.id, {
      state: next,
      stateChangedAtMs: atMs,
      stateChangedBy: actor,
      stateLog: [...(record.stateLog ?? []), change],
    }) ?? record
  );
}

function assertAvailable(state: CheckpointsState): void {
  if (state.isAvailable) return;
  throw new ChangeSetActionError(
    CHANGE_SET_ERRORS.UNAVAILABLE,
    "Change sets are off: git is not installed.",
  );
}

async function undo(
  state: CheckpointsState,
  id: string,
  includeLater: boolean,
  actor: string | undefined,
): Promise<ChangeSetRecord[]> {
  assertAvailable(state);
  const record = requireRecord(state, id);
  requireState(record, "applied");
  const targets = includeLater
    ? [...laterConflicts(state, record), record]
    : [record];
  return serialize(state, async () => {
    const undone: ChangeSetRecord[] = [];
    for (const target of targets) {
      await state.git.restore(target.beforeTree, pathsOf(target));
      undone.push(markState(state, target, "undone", actor));
    }
    return undone;
  });
}

async function redo(
  state: CheckpointsState,
  id: string,
  actor: string | undefined,
): Promise<ChangeSetRecord[]> {
  assertAvailable(state);
  const record = requireRecord(state, id);
  requireState(record, "undone");
  return serialize(state, async () => {
    await state.git.restore(record.afterTree, pathsOf(record));
    return [markState(state, record, "applied", actor)];
  });
}

async function fileDetails(
  state: CheckpointsState,
  id: string,
): Promise<ChangeSetFileDetail[]> {
  const record = requireRecord(state, id);
  if (!state.isAvailable) {
    return record.files.map((file) => ({
      ...file,
      hunks: [],
      isBinary: false,
    }));
  }
  return Promise.all(
    record.files.map(async (file) => {
      const diff = await state.git
        .fileDiff(record.beforeTree, record.afterTree, file.path)
        .catch(() => ({ text: "", isBinary: false }));
      return {
        ...file,
        hunks: parseUnifiedDiff(diff.text).hunks,
        isBinary: diff.isBinary,
      };
    }),
  );
}

async function pruneExpired(state: CheckpointsState, retentionDays: number) {
  const cutoff = Date.now() - retentionDays * MS_PER_DAY;
  const expired = state.store.all().filter((c) => c.createdAtMs < cutoff);
  if (expired.length === 0) return;
  for (const record of expired) await state.git.drop(record.id);
  state.store.remove(expired.map((record) => record.id));
  void state.git.prune().catch(() => undefined);
}

async function start(state: CheckpointsState, retentionDays: number) {
  await state.store.load();
  if (!(await state.git.isInstalled())) return;
  try {
    await state.git.init();
    state.isAvailable = true;
    await pruneExpired(state, retentionDays);
  } catch (err) {
    console.warn(`${CHECKPOINTS_LOG_PREFIX} unavailable: ${String(err)}`);
  }
}

export function createCheckpoints(deps: CheckpointsDeps): Checkpoints {
  const state: CheckpointsState = {
    ...deps,
    isAvailable: false,
    lock: Promise.resolve(),
    running: new Set(),
  };
  return {
    isAvailable: () => state.isAvailable,
    start: (retentionDays) => start(state, retentionDays),
    beginTurn: () => beginTurn(state),
    all: () => state.store.all(),
    get: (id) => state.store.get(id),
    forConversation: (conversationId) =>
      state.store
        .all()
        .filter((c) => c.conversationId === conversationId)
        .map(toSummary),
    fileDetails: (id) => fileDetails(state, id),
    undoPreview: (id) => undoPreview(state, id),
    undo: (id, includeLater, actor) => undo(state, id, includeLater, actor),
    redo: (id, actor) => redo(state, id, actor),
    flush: () => state.store.flush(),
    setTypecheck: (id, outcome) =>
      state.store.update(id, { typecheck: outcome }),
  };
}

/** Where the shadow repository lives and what it leaves out. */
export function checkpointExcludes(stateDir: string, root: string): string[] {
  const relative = path.relative(root, stateDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return [];
  return [relative.split(path.sep).join("/")];
}
