/**
 * Teardowns still under way, so a dispose can wait for the ones it did not
 * start itself: a session that ended on its own, one evicted to make room, a
 * backend retired by a provider switch.
 */
export interface DisposalTracker {
  track(disposal: Promise<void>): void;
  /** Resolves once every tracked teardown has, including any added meanwhile. */
  settle(): Promise<void>;
}

export function createDisposalTracker(): DisposalTracker {
  const pending = new Set<Promise<void>>();
  return {
    track: (disposal) => {
      pending.add(disposal);
      void disposal.then(() => pending.delete(disposal));
    },
    settle: async () => {
      while (pending.size > 0) await Promise.all(pending);
    },
  };
}
