import type { RunnerEvent } from "../../agent/runner-events.js";

export interface RunnerEventStream {
  push(event: RunnerEvent): void;
  /** Ends the stream; a consumer awaiting the next event sees it finish. */
  end(): void;
  /**
   * Fails the stream. The neutral session turns a rejection into a terminal
   * error event, which is how an aborted turn (idle timeout, interrupt
   * fallback) stops instead of waiting for a `done` that will never come.
   */
  fail(reason: Error): void;
  iterator: AsyncIterator<RunnerEvent, void>;
}

type Waiter = {
  resolve: (result: IteratorResult<RunnerEvent, void>) => void;
  reject: (reason: Error) => void;
};

/**
 * Bridges the app-server's push notifications to the pull-based iterator the
 * neutral session consumes. Events are buffered, so nothing is lost between two
 * calls to `next()`.
 */
export function createRunnerEventStream(): RunnerEventStream {
  const buffered: RunnerEvent[] = [];
  let waiter: Waiter | null = null;
  let ended = false;
  let failure: Error | null = null;

  function takeWaiter(): Waiter | null {
    const pending = waiter;
    waiter = null;
    return pending;
  }

  return {
    push(event) {
      if (ended) return;
      const pending = takeWaiter();
      if (pending !== null) {
        pending.resolve({ value: event, done: false });
        return;
      }
      buffered.push(event);
    },
    end() {
      if (ended) return;
      ended = true;
      takeWaiter()?.resolve({ value: undefined, done: true });
    },
    fail(reason) {
      if (ended) return;
      ended = true;
      failure = reason;
      takeWaiter()?.reject(reason);
    },
    iterator: {
      next: () => {
        const queued = buffered.shift();
        if (queued !== undefined) {
          return Promise.resolve({ value: queued, done: false });
        }
        if (failure !== null) return Promise.reject(failure);
        if (ended) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<RunnerEvent, void>>(
          (resolve, reject) => {
            waiter = { resolve, reject };
          },
        );
      },
    },
  };
}
