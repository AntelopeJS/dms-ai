import type {
  PermissionMode,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  INTERRUPT_FALLBACK_MS,
  SDK_TIMEOUT_MESSAGE,
} from "../constants/agent.js";
import type { TurnContent } from "./attachments.js";
import type { InputQueue } from "./input-queue.js";
import type { RunnerEvent } from "./runner-events.js";
import { messageToEvents } from "./sdk-adapter.js";

const RESULT_MESSAGE_TYPE = "result";

export interface ClaudeSession {
  sendTurn(content: TurnContent, timeoutMs: number): AsyncIterable<RunnerEvent>;
  setPermissionMode(mode: PermissionMode): void;
  setMaxThinkingTokens(tokens: number | null): void;
  interrupt(): void;
  dispose: () => void;
}

export interface SessionDeps {
  output: Query;
  input: InputQueue;
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
}

function buildUserMessage(content: TurnContent): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: "",
  };
}

function disposeSession(state: SessionState): void {
  if (state.disposed) return;
  state.disposed = true;
  clearInterruptFallback(state);
  state.input.close();
  state.abortController.abort();
  state.onDisposed();
}

function setPermissionMode(state: SessionState, mode: PermissionMode): void {
  if (state.disposed) return;
  void state.output.setPermissionMode(mode).catch(() => undefined);
}

function setMaxThinkingTokens(
  state: SessionState,
  tokens: number | null,
): void {
  if (state.disposed) return;
  void state.output.setMaxThinkingTokens(tokens).catch(() => undefined);
}

function clearInterruptFallback(state: SessionState): void {
  if (state.interruptTimer === null) return;
  clearTimeout(state.interruptTimer);
  state.interruptTimer = null;
}

// Gracefully interrupt the in-flight turn. The SDK should emit a `result`
// message in response, ending the turn loop (see readTurn) without disposing the
// session — so the conversation stays warm. If the SDK ignores the interrupt (or
// the turn is mid-tool and won't settle), a fallback hard-aborts after a grace
// window so Stop can never silently hang.
function interrupt(state: SessionState): void {
  if (state.disposed) return;
  if (state.activeTurns === 0) return;
  void state.output.interrupt().catch(() => undefined);
  clearInterruptFallback(state);
  state.interruptTimer = setTimeout(() => {
    state.interruptTimer = null;
    if (state.disposed || state.activeTurns === 0) return;
    state.abortController.abort();
  }, INTERRUPT_FALLBACK_MS);
}

// Idle timeout, not a wall-clock cap. The deadline is pushed out every time the
// SDK produces a message (see readTurn), so a healthy turn that legitimately
// runs for a long time is never aborted — only one that goes fully silent for
// the whole window (a genuine hang) is.
function armTurnTimeout(state: SessionState, timeoutMs: number): TurnTimeout {
  const flag: TimeoutFlag = { isTimedOut: false };
  let timer: ReturnType<typeof setTimeout>;
  const arm = (): void => {
    timer = setTimeout(() => {
      flag.isTimedOut = true;
      state.abortController.abort();
    }, timeoutMs);
  };
  arm();
  return {
    flag,
    clear: () => clearTimeout(timer),
    reset: () => {
      clearTimeout(timer);
      arm();
    },
  };
}

function buildErrorEvent(err: unknown, flag: TimeoutFlag): RunnerEvent {
  if (flag.isTimedOut) return { type: "error", message: SDK_TIMEOUT_MESSAGE };
  const message = err instanceof Error ? err.message : String(err);
  return { type: "error", message };
}

async function* readTurn(
  state: SessionState,
  timeout: TurnTimeout,
): AsyncIterable<RunnerEvent> {
  let outstandingTools = 0;
  while (true) {
    let result: IteratorResult<SDKMessage, void>;
    try {
      result = await state.output.next();
    } catch (err) {
      yield buildErrorEvent(err, timeout.flag);
      disposeSession(state);
      return;
    }
    if (result.done) {
      disposeSession(state);
      return;
    }
    for (const event of messageToEvents(result.value)) {
      if (event.type === "tool_use") outstandingTools += 1;
      else if (event.type === "tool_result") {
        outstandingTools = Math.max(0, outstandingTools - 1);
      }
      yield event;
    }
    // While a tool is executing the turn is legitimately silent, so suspend the
    // idle timer; otherwise a message is progress, so re-arm it to keep catching
    // a genuine model hang.
    if (outstandingTools > 0) timeout.clear();
    else timeout.reset();
    if (result.value.type === RESULT_MESSAGE_TYPE) return;
  }
}

async function* runTurn(
  state: SessionState,
  content: TurnContent,
  timeoutMs: number,
): AsyncIterable<RunnerEvent> {
  state.input.push(buildUserMessage(content));
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
  content: TurnContent,
  timeoutMs: number,
  previous: Promise<void>,
  release: () => void,
): AsyncIterable<RunnerEvent> {
  await previous;
  try {
    yield* runTurn(state, content, timeoutMs);
  } finally {
    release();
  }
}

function sendTurn(
  state: SessionState,
  content: TurnContent,
  timeoutMs: number,
): AsyncIterable<RunnerEvent> {
  const previous = state.tail;
  let release: () => void = () => {};
  state.tail = new Promise((resolve) => {
    release = resolve;
  });
  return chainTurn(state, content, timeoutMs, previous, release);
}

export function createClaudeSession(deps: SessionDeps): ClaudeSession {
  const state: SessionState = {
    ...deps,
    disposed: false,
    tail: Promise.resolve(),
    activeTurns: 0,
    interruptTimer: null,
  };
  return {
    sendTurn: (content, timeoutMs) => sendTurn(state, content, timeoutMs),
    setPermissionMode: (mode) => setPermissionMode(state, mode),
    setMaxThinkingTokens: (tokens) => setMaxThinkingTokens(state, tokens),
    interrupt: () => interrupt(state),
    dispose: () => disposeSession(state),
  };
}
