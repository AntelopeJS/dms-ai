import { BLOCKS_REPORT_GRACE_MS } from "../constants/timing.js";
import type { PageBlockType } from "../protocol/messages.js";

/** What the host announced when the page landed. */
export interface NavigationAnnouncement {
  /** A block report for this path follows within this long. */
  blocksWithinMs?: number;
}

/** The landed page: the block report its host announced, when it did. */
export interface NavigationLanding {
  /** Resolves with the report, or null when it did not arrive in time. */
  blocks?: Promise<PageBlocksReport | null>;
}

/** What the host's data blocks showed once the page stopped changing. */
export interface PageBlocksReport {
  status: "settled" | "timeout" | "superseded";
  /** How many data blocks the page holds. */
  checked: number;
  /** The blocks that are empty, failed or still loading. */
  blocks: PageBlockType[];
}

export interface NavigationCompleter {
  waitFor: (
    path: string,
    timeoutMs: number,
  ) => Promise<NavigationLanding | null>;
  complete: (path: string, announcement?: NavigationAnnouncement) => void;
  completeBlocks: (path: string, report: PageBlocksReport) => void;
}

interface PendingEntry<T> {
  resolve: (value: T | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Waiters per path, each resolved once with a value or, at its deadline, `null`. */
interface Rendezvous<T> {
  wait: (path: string, timeoutMs: number) => Promise<T | null>;
  /** Resolves the oldest waiter of `path` with `make()`, called only if there is one. */
  deliver: (path: string, make: () => T) => void;
}

function createRendezvous<T>(): Rendezvous<T> {
  const pending = new Map<string, PendingEntry<T>[]>();

  const popEntry = (path: string): PendingEntry<T> | undefined => {
    const entries = pending.get(path);
    const entry = entries?.shift();
    if (entries?.length === 0) pending.delete(path);
    return entry;
  };

  return {
    wait: (path, timeoutMs) =>
      new Promise<T | null>((resolve) => {
        const entry: PendingEntry<T> = {
          resolve,
          timer: setTimeout(() => {
            const entries = pending.get(path);
            const index = entries?.indexOf(entry) ?? -1;
            if (entries === undefined || index < 0) return;
            entries.splice(index, 1);
            if (entries.length === 0) pending.delete(path);
            resolve(null);
          }, timeoutMs),
        };
        pending.set(path, [...(pending.get(path) ?? []), entry]);
      }),
    deliver: (path, make) => {
      const entry = popEntry(path);
      if (entry === undefined) return;
      clearTimeout(entry.timer);
      entry.resolve(make());
    },
  };
}

export function createNavigationCompleter(): NavigationCompleter {
  const landings = createRendezvous<NavigationLanding>();
  const reports = createRendezvous<PageBlocksReport>();
  return {
    waitFor: landings.wait,
    complete: (path, { blocksWithinMs } = {}) =>
      landings.deliver(path, () =>
        blocksWithinMs === undefined
          ? {}
          : {
              blocks: reports.wait(
                path,
                blocksWithinMs + BLOCKS_REPORT_GRACE_MS,
              ),
            },
      ),
    completeBlocks: (path, report) => reports.deliver(path, () => report),
  };
}
