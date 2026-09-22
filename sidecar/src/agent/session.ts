import {
  INTERRUPT_FALLBACK_MS,
  TURN_IDLE_TIMEOUT_MESSAGE,
} from "../constants/agent.js";
import { TOOL_EXECUTION_CAP_MS } from "../constants/timing.js";
import type { AppSettings } from "../state/settings-types.js";
import type { TurnInput } from "./provider.js";
import type { RunnerEvent } from "./runner-events.js";

/**
 * The backend-specific half of a session: everything the neutral lifecycle needs
 * to drive an agent without knowing which one it is.
 */
export interface SessionControls {
  /** Hands one turn to the backend. Called from inside the turn chain. */
  submitTurn(input: TurnInput): void | Promise<void>;
  interrupt(): void;
  /** Releases whatever the backend holds between turns. */
  close(): void;
  applySettings?(settings: AppSettings): void;
}

export interface AgentSession {
  sendTurn(input: TurnInput, timeoutMs: number): AsyncIterable<RunnerEvent>;
  applySettings(settings: AppSettings): void;
  interrupt(): void;
  dispose: () => void;
}

export interface SessionDeps {
  events: AsyncIterator<RunnerEvent, void>;
  controls: SessionControls;
  abortController: AbortController;
  onDisposed: () => void;
}

interface SessionState extends SessionDeps {
  disposed: boolean;
  tail: Promise<void>;
  activeTurns: number;
  interruptTimer: ReturnType<typeof setTimeout> | null;
}

interface TimeoutFlag {
  isTimedOut: boolean;
}

interface TurnTimeout {
  flag: TimeoutFlag;
  clear: () => void;
  reset: () => void;
  /** Arms the far longer tool-execution bound instead of disarming outright. */
  suspend: () => void;
}

function disposeSession(state: SessionState): void {
  if (state.disposed) return;
  state.disposed = true;
  clearInterruptFallback(state);
  state.controls.close();
  state.abortController.abort();
  state.onDisposed();
}

function applySettings(state: SessionState, settings: AppSettings): void {
  if (state.disposed) return;
  state.controls.applySettings?.(settings);
}

function clearInterruptFallback(state: SessionState): void {
  if (state.interruptTimer === null) return;
  clearTimeout(state.interruptTimer);
  state.interruptTimer = null;
}

// Gracefully interrupt the in-flight turn. The backend should answer with a
// `done` event, ending the turn loop (see readTurn) without disposing the
// session — so the conversation stays warm. If the backend ignores the interrupt
// (or the turn is mid-tool and won't settle), a fallback hard-aborts after a
// grace window so Stop can never silently hang.
function interrupt(state: SessionState): void {
  if (state.disposed) return;
  if (state.activeTurns === 0) return;
  state.controls.interrupt();
  clearInterruptFallback(state);
  state.interruptTimer = setTimeout(() => {
    state.interruptTimer = null;
    if (state.disposed || state.activeTurns === 0) return;
    state.abortController.abort();
  }, INTERRUPT_FALLBACK_MS);
}

// Idle timeout, not a wall-clock cap. The deadline is pushed out every time the
// backend produces an event (see readTurn), so a healthy turn that legitimately
// runs for a long time is never aborted — only one that goes fully silent for
// the whole window (a genuine hang) is.
function armTurnTimeout(state: SessionState, timeoutMs: number): TurnTimeout {
  const flag: TimeoutFlag = { isTimedOut: false };
  let timer: ReturnType<typeof setTimeout>;
  const arm = (delayMs: number): void => {
    timer = setTimeout(() => {
      flag.isTimedOut = true;
      state.abortController.abort();
    }, delayMs);
  };
  arm(timeoutMs);
  return {
    flag,
    clear: () => clearTimeout(timer),
    reset: () => {
      clearTimeout(timer);
      arm(timeoutMs);
    },
    suspend: () => {
      clearTimeout(timer);
      arm(TOOL_EXECUTION_CAP_MS);
    },
  };
}

function buildErrorEvent(err: unknown, flag: TimeoutFlag): RunnerEvent {
  if (flag.isTimedOut)
    return { type: "error", message: TURN_IDLE_TIMEOUT_MESSAGE };
  const message = err instanceof Error ? err.message : String(err);
  return { type: "error", message };
}

const OUTSTANDING_TOOL_DELTAS: Record<string, number> = {
  tool_use: 1,
  tool_result: -1,
};

function countOutstanding(outstanding: number, event: RunnerEvent): number {
  const delta = OUTSTANDING_TOOL_DELTAS[event.type] ?? 0;
  return Math.max(0, outstanding + delta);
}

async function* readTurn(
  state: SessionState,
  timeout: TurnTimeout,
): AsyncIterable<RunnerEvent> {
  let outstandingTools = 0;
  while (true) {
    let result: IteratorResult<RunnerEvent, void>;
    try {
      result = await state.events.next();
    } catch (err) {
      yield buildErrorEvent(err, timeout.flag);
      disposeSession(state);
      return;
    }
    if (result.done) {
      disposeSession(state);
      return;
    }
    const event = result.value;
    outstandingTools = countOutstanding(outstandingTools, event);
    yield event;
    // While a tool is executing the turn is legitimately silent, so suspend the
    // idle timer; otherwise an event is progress, so re-arm it to keep catching
    // a genuine model hang.
    if (outstandingTools > 0) timeout.suspend();
    else timeout.reset();
    if (event.type === "done") return;
  }
}

async function* runTurn(
  state: SessionState,
  input: TurnInput,
  timeoutMs: number,
): AsyncIterable<RunnerEvent> {
  await state.controls.submitTurn(input);
  state.activeTurns += 1;
  const timeout = armTurnTimeout(state, timeoutMs);
  try {
    yield* readTurn(state, timeout);
  } finally {
    timeout.clear();
    state.activeTurns -= 1;
    if (state.activeTurns === 0) clearInterruptFallback(state);
  }
}

async function* chainTurn(
  state: SessionState,
  input: TurnInput,
  timeoutMs: number,
  previous: Promise<void>,
  release: () => void,
): AsyncIterable<RunnerEvent> {
  await previous;
  try {
    yield* runTurn(state, input, timeoutMs);
  } finally {
    release();
  }
}

function sendTurn(
  state: SessionState,
  input: TurnInput,
  timeoutMs: number,
): AsyncIterable<RunnerEvent> {
  const previous = state.tail;
  let release: () => void = () => {};
  state.tail = new Promise((resolve) => {
    release = resolve;
  });
  return chainTurn(state, input, timeoutMs, previous, release);
}

export function createAgentSession(deps: SessionDeps): AgentSession {
  const state: SessionState = {
    ...deps,
    disposed: false,
    tail: Promise.resolve(),
    activeTurns: 0,
    interruptTimer: null,
  };
  return {
    sendTurn: (input, timeoutMs) => sendTurn(state, input, timeoutMs),
    applySettings: (settings) => applySettings(state, settings),
    interrupt: () => interrupt(state),
    dispose: () => disposeSession(state),
  };
}
