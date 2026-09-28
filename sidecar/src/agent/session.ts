import {
  INTERRUPT_FALLBACK_MS,
  TURN_SESSION_CLOSED_MESSAGE,
  TURN_STOPPED_MESSAGE,
  TURN_STREAM_ENDED_MESSAGE,
} from "../constants/agent.js";
import { TOOL_EXECUTION_CAP_MS } from "../constants/timing.js";
import type { AppSettings } from "../state/settings-types.js";
import type { TurnInput } from "./provider.js";
import type { RunnerEvent } from "./runner-events.js";
import { idleTimeoutReason, toolCapReason } from "./turn-end-reasons.js";

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
  /** Why the session was aborted, reported instead of the provider's own wording. */
  abortReason: string | null;
}

interface TurnTimeout {
  clear: () => void;
  reset: () => void;
  /** Arms the far longer tool-execution bound instead of disarming outright. */
  suspend: () => void;
}

/** Aborts the backend, keeping the first reason given for it. */
function abortWith(state: SessionState, reason: string): void {
  if (state.abortReason === null) state.abortReason = reason;
  state.abortController.abort();
}

function disposeSession(state: SessionState): void {
  if (state.disposed) return;
  state.disposed = true;
  clearInterruptFallback(state);
  state.controls.close();
  abortWith(state, TURN_SESSION_CLOSED_MESSAGE);
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
    abortWith(state, TURN_STOPPED_MESSAGE);
  }, INTERRUPT_FALLBACK_MS);
}

// Idle timeout, not a wall-clock cap. The deadline is pushed out every time the
// backend produces an event (see readTurn), so a healthy turn that legitimately
// runs for a long time is never aborted — only one that goes fully silent for
// the whole window (a genuine hang) is.
function armTurnTimeout(state: SessionState, timeoutMs: number): TurnTimeout {
  const idleReason = idleTimeoutReason(timeoutMs);
  const toolReason = toolCapReason(TOOL_EXECUTION_CAP_MS);
  let timer: ReturnType<typeof setTimeout>;
  const arm = (delayMs: number, reason: string): void => {
    timer = setTimeout(() => abortWith(state, reason), delayMs);
  };
  arm(timeoutMs, idleReason);
  return {
    clear: () => clearTimeout(timer),
    reset: () => {
      clearTimeout(timer);
      arm(timeoutMs, idleReason);
    },
    suspend: () => {
      clearTimeout(timer);
      arm(TOOL_EXECUTION_CAP_MS, toolReason);
    },
  };
}

function buildErrorEvent(state: SessionState, err: unknown): RunnerEvent {
  if (state.abortReason !== null) {
    return { type: "error", message: state.abortReason };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { type: "error", message };
}

/**
 * A provider stream that ends before `done` would otherwise end the turn with
 * no terminal event at all, and the chat would wait for one forever.
 */
function buildStreamEndedEvent(state: SessionState): RunnerEvent {
  return {
    type: "error",
    message: state.abortReason ?? TURN_STREAM_ENDED_MESSAGE,
  };
}

const OUTSTANDING_TOOL_DELTAS: Record<string, number> = {
  tool_use: 1,
  tool_result: -1,
};

function countOutstanding(outstanding: number, event: RunnerEvent): number {
  const delta = OUTSTANDING_TOOL_DELTAS[event.type] ?? 0;
  return Math.max(0, outstanding + delta);
}

/**
 * Re-arms the timer after an event. Without an outstanding tool, any event —
 * provider activity included — proves the agent alive and restarts the idle
 * window. While a tool runs, the far longer tool cap is armed again only by a
 * real turn event: progress reported by the running tool itself never extends
 * it, so a tool whose result never comes back still ends the turn.
 */
function rearmAfter(
  timeout: TurnTimeout,
  event: RunnerEvent,
  outstandingTools: number,
): void {
  if (outstandingTools === 0) {
    timeout.reset();
    return;
  }
  if (event.type !== "activity") timeout.suspend();
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
      yield buildErrorEvent(state, err);
      disposeSession(state);
      return;
    }
    if (result.done) {
      yield buildStreamEndedEvent(state);
      disposeSession(state);
      return;
    }
    const event = result.value;
    outstandingTools = countOutstanding(outstandingTools, event);
    yield event;
    rearmAfter(timeout, event, outstandingTools);
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
    abortReason: null,
  };
  return {
    sendTurn: (input, timeoutMs) => sendTurn(state, input, timeoutMs),
    applySettings: (settings) => applySettings(state, settings),
    interrupt: () => interrupt(state),
    dispose: () => disposeSession(state),
  };
}
