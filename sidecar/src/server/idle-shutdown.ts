export interface IdleShutdownOptions {
  idleMs: number;
  onIdle: () => void;
}

export interface IdleShutdownController {
  increment: () => void;
  decrement: () => void;
  touch: () => void;
}

interface IdleState {
  idleMs: number;
  onIdle: () => void;
  connections: number;
  timer: NodeJS.Timeout | null;
}

function clearIdleTimer(state: IdleState): void {
  if (state.timer === null) return;
  clearTimeout(state.timer);
  state.timer = null;
}

function armIdleTimer(state: IdleState): void {
  clearIdleTimer(state);
  if (state.connections > 0) return;
  state.timer = setTimeout(state.onIdle, state.idleMs);
}

function incrementConnections(state: IdleState): void {
  state.connections += 1;
  clearIdleTimer(state);
}

function decrementConnections(state: IdleState): void {
  state.connections = Math.max(0, state.connections - 1);
  armIdleTimer(state);
}

export function createIdleShutdownController(
  options: IdleShutdownOptions,
): IdleShutdownController {
  const state: IdleState = {
    idleMs: options.idleMs,
    onIdle: options.onIdle,
    connections: 0,
    timer: null,
  };
  armIdleTimer(state);
  return {
    increment: () => incrementConnections(state),
    decrement: () => decrementConnections(state),
    touch: () => armIdleTimer(state),
  };
}
