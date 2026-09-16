export interface NavigationCompleter {
  waitFor: (path: string, timeoutMs: number) => Promise<boolean>;
  complete: (path: string) => void;
}

interface PendingEntry {
  resolve: (value: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface CompleterState {
  pending: Map<string, PendingEntry[]>;
}

function popEntry(
  state: CompleterState,
  path: string,
): PendingEntry | undefined {
  const entries = state.pending.get(path);
  if (entries === undefined) return undefined;
  if (entries.length === 0) return undefined;
  const entry = entries.shift();
  if (entries.length === 0) state.pending.delete(path);
  return entry;
}

function appendEntry(
  state: CompleterState,
  path: string,
  entry: PendingEntry,
): void {
  const existing = state.pending.get(path);
  if (existing === undefined) {
    state.pending.set(path, [entry]);
    return;
  }
  existing.push(entry);
}

function buildWaitFor(state: CompleterState) {
  return (path: string, timeoutMs: number): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const removed = popEntry(state, path);
        if (removed === undefined) return;
        resolve(false);
      }, timeoutMs);
      appendEntry(state, path, { resolve, timer });
    });
  };
}

function buildComplete(state: CompleterState) {
  return (path: string): void => {
    const entry = popEntry(state, path);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    entry.resolve(true);
  };
}

export function createNavigationCompleter(): NavigationCompleter {
  const state: CompleterState = { pending: new Map() };
  return {
    waitFor: buildWaitFor(state),
    complete: buildComplete(state),
  };
}
