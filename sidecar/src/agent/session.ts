import {
  INTERRUPT_FALLBACK_MS,
  TURN_SESSION_CLOSED_MESSAGE,
  TURN_STREAM_ENDED_MESSAGE,
} from "../constants/agent.js";
import { TOOL_EXECUTION_CAP_MS } from "../constants/timing.js";
import type { AppSettings } from "../state/settings-types.js";
import type { TurnInput } from "./provider.js";
import type { RunnerError, RunnerEvent } from "./runner-events.js";
import { idleTimeoutReason, toolCapReason } from "./turn-end-reasons.js";

/**
 * The backend-specific half of a session: everything the neutral lifecycle needs
 * to drive an agent without knowing which one it is.
 */
export interface SessionControls {
  /** Hands one turn to the backend. Called from inside the turn chain. */
  submitTurn(input: TurnInput): void | Promise<void>;
  interrupt(): void;
  /**
   * Releases whatever the backend holds between turns, and resolves once it is
   * released. Never rejects.
   */
  close(): Promise<void>;
  applySettings?(settings: AppSettings): void;
}

export interface AgentSession {
  sendTurn(input: TurnInput, timeoutMs: number): AsyncIterable<RunnerEvent>;
  applySettings(settings: AppSettings): void;
  interrupt(): void;
  /**
   * Resolves once the backend has released everything. Every caller gets the
   * same teardown, so a second one never returns ahead of it.
   */
  dispose: () => Promise<void>;
}

export interface SessionDeps {
  events: AsyncIterator<RunnerEvent, void>;
  controls: SessionControls;
  abortController: AbortController;
  /**
   * Handed the teardown as well, so whoever drops the session can still wait
   * for it.
   */
  onDisposed: (disposal: Promise<void>) => void;
}

interface SessionState extends SessionDeps {
  disposal: Promise<void> | null;
  tail: Promise<void>;
  activeTurns: number;
  interruptTimer: ReturnType<typeof setTimeout> | null;
  abortOutcome: RunnerEvent | null;
}

interface TurnTimeout {
  clear: () => void;
  reset: () => void;
  /** Arms the far longer tool-execution bound instead of disarming outright. */
  suspend: () => void;
}

function isDisposed(state: SessionState): boolean {
  return state.disposal !== null;
}

const STOPPED_OUTCOME: RunnerEvent = { type: "done" };

function errorOutcome(message: string): RunnerError {
  return { type: "error", message };
}

function abortWith(state: SessionState, outcome: RunnerEvent): void {
  if (state.abortOutcome === null) state.abortOutcome = outcome;
  state.abortController.abort();
}

function disposeSession(state: SessionState): Promise<void> {
  if (state.disposal !== null) return state.disposal;
  clearInterruptFallback(state);
  const disposal = state.controls.close();
  state.disposal = disposal;
  abortWith(state, errorOutcome(TURN_SESSION_CLOSED_MESSAGE));
  state.onDisposed(disposal);
  return disposal;
}

function applySettings(state: SessionState, settings: AppSettings): void {
  if (isDisposed(state)) return;
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
  if (isDisposed(state)) return;
  if (state.activeTurns === 0) return;
  state.controls.interrupt();
  clearInterruptFallback(state);
  state.interruptTimer = setTimeout(() => {
    state.interruptTimer = null;
    if (isDisposed(state) || state.activeTurns === 0) return;
    abortWith(state, STOPPED_OUTCOME);
  }, INTERRUPT_FALLBACK_MS);
}

// Idle timeout, not a wall-clock cap. The deadline is pushed out every time the
// backend produces an event (see readTurn), so a healthy turn that legitimately
// runs for a long time is never aborted — only one that goes fully silent for
// the whole window (a genuine hang) is.
function armTurnTimeout(state: SessionState, timeoutMs: number): TurnTimeout {
  const idleOutcome = errorOutcome(idleTimeoutReason(timeoutMs));
  const toolOutcome = errorOutcome(toolCapReason(TOOL_EXECUTION_CAP_MS));
  let timer: ReturnType<typeof setTimeout>;
  const arm = (delayMs: number, outcome: RunnerEvent): void => {
    timer = setTimeout(() => abortWith(state, outcome), delayMs);
  };
  arm(timeoutMs, idleOutcome);
  return {
    clear: () => clearTimeout(timer),
    reset: () => {
      clearTimeout(timer);
      arm(timeoutMs, idleOutcome);
    },
    suspend: () => {
      clearTimeout(timer);
      arm(TOOL_EXECUTION_CAP_MS, toolOutcome);
    },
  };
}

function buildErrorEvent(state: SessionState, err: unknown): RunnerEvent {
  if (state.abortOutcome !== null) return state.abortOutcome;
  return errorOutcome(err instanceof Error ? err.message : String(err));
}

function buildStreamEndedEvent(state: SessionState): RunnerEvent {
  return state.abortOutcome ?? errorOutcome(TURN_STREAM_ENDED_MESSAGE);
}

const OUTSTANDING_TOOL_DELTAS: Record<string, number> = {
  tool_use: 1,
  tool_result: -1,
};

function countOutstanding(outstanding: number, event: RunnerEvent): number {
  const delta = OUTSTANDING_TOOL_DELTAS[event.type] ?? 0;
  return Math.max(0, outstanding + delta);
}

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
      void disposeSession(state);
      return;
    }
    if (result.done) {
      yield buildStreamEndedEvent(state);
      void disposeSession(state);
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
    disposal: null,
    tail: Promise.resolve(),
    activeTurns: 0,
    interruptTimer: null,
    abortOutcome: null,
  };
  return {
    sendTurn: (input, timeoutMs) => sendTurn(state, input, timeoutMs),
    applySettings: (settings) => applySettings(state, settings),
    interrupt: () => interrupt(state),
    dispose: () => disposeSession(state),
  };
}
