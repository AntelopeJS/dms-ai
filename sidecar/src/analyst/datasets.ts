import { z } from "zod";
import {
  ANALYST_DATASET_ROW_CAP,
  ANALYST_SIDECAR_ROW_BUDGET,
} from "../constants/analyst.js";
import { JsonValueSchema } from "../protocol/json.js";

/** One row as a table's list route answers it. */
export const AnalystRowSchema = z.record(z.string(), JsonValueSchema);
export type AnalystRow = z.infer<typeof AnalystRowSchema>;

interface PooledDataset {
  owner: AnalystDatasets;
  name: string;
  rows: readonly AnalystRow[];
}

/**
 * Every conversation's datasets together, held to one row budget for the
 * whole sidecar: loading past it evicts the datasets used least recently,
 * whichever conversation holds them.
 */
export interface AnalystDatasetPool {
  budget: number;
  /** Least recently used first. */
  entries: PooledDataset[];
  /** Rows held across every conversation. */
  held(): number;
}

export function createAnalystDatasetPool(
  budget: number = ANALYST_SIDECAR_ROW_BUDGET,
): AnalystDatasetPool {
  const state: AnalystDatasetPool = {
    budget,
    entries: [],
    held: () => state.entries.reduce((sum, e) => sum + e.rows.length, 0),
  };
  return state;
}

const sharedPool = createAnalystDatasetPool();

/**
 * One conversation's loaded datasets. Together they never hold more rows than
 * the conversation's cap, and the pool may evict them to stay within the
 * sidecar's budget; an evicted dataset is named until it is loaded again.
 */
export interface AnalystDatasets {
  /** The rows a dataset named `name` may hold, were it loaded again. */
  room(name: string): number;
  /** Stores `rows` under `name`, cut to the room left; returns how many it kept. */
  put(name: string, rows: AnalystRow[]): number;
  /** The datasets still held, marked as just used. */
  all(): ReadonlyMap<string, readonly AnalystRow[]>;
  /** Datasets evicted since they were loaded. */
  evicted(): string[];
}

function evictFor(
  state: AnalystDatasetPool,
  rows: number,
  keep: PooledDataset,
): void {
  while (state.held() + rows > state.budget) {
    const index = state.entries.findIndex((entry) => entry !== keep);
    if (index === -1) return;
    const [gone] = state.entries.splice(index, 1);
    gone?.owner.evicted().push(gone.name);
  }
}

export function createAnalystDatasets(
  cap: number = ANALYST_DATASET_ROW_CAP,
  pool: AnalystDatasetPool = sharedPool,
): AnalystDatasets {
  const evicted: string[] = [];
  const mine = () => pool.entries.filter((entry) => entry.owner === datasets);
  const room = (name: string) => {
    const held = mine()
      .filter((entry) => entry.name !== name)
      .reduce((sum, entry) => sum + entry.rows.length, 0);
    return Math.max(0, cap - held);
  };
  const datasets: AnalystDatasets = {
    room,
    put(name, rows) {
      const kept = rows.slice(0, room(name));
      pool.entries = pool.entries.filter(
        (entry) => entry.owner !== datasets || entry.name !== name,
      );
      const entry: PooledDataset = { owner: datasets, name, rows: kept };
      evictFor(pool, kept.length, entry);
      pool.entries.push(entry);
      evicted.splice(0, evicted.length, ...evicted.filter((n) => n !== name));
      return kept.length;
    },
    all() {
      const held = mine();
      pool.entries = [
        ...pool.entries.filter((entry) => entry.owner !== datasets),
        ...held,
      ];
      return new Map(held.map((entry) => [entry.name, entry.rows]));
    },
    evicted: () => evicted,
  };
  return datasets;
}
