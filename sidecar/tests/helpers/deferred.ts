export interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

export function defer(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export interface SettleWatch {
  isSettled: () => boolean;
}

export function watchSettle(promise: Promise<unknown>): SettleWatch {
  let isSettled = false;
  void promise.then(() => {
    isSettled = true;
  });
  return { isSettled: () => isSettled };
}

/**
 * Lets every pending callback run, so a promise still pending afterwards is
 * genuinely waiting on something rather than on the next tick.
 */
export function flushCallbacks(): Promise<void> {
  return new Promise((done) => setImmediate(done));
}
