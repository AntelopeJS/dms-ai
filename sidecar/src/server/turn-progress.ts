import type { ActivityKind, RunnerEvent } from "../agent/runner-events.js";
import { TURN_PROGRESS_HEARTBEAT_MS } from "../constants/timing.js";
import { EVENT_TYPES, type RunProgressEventType } from "../protocol/events.js";

export interface TurnProgressOptions {
  conversationId: string;
  send: (event: RunProgressEventType) => void;
  heartbeatMs?: number;
  now?: () => number;
}

/** Tracks what one running turn is doing and keeps the chat informed. */
export interface TurnProgress {
  observe: (event: RunnerEvent) => void;
  stop: () => void;
}

interface CurrentActivity {
  kind: ActivityKind;
  detail?: string;
}

interface ProgressState {
  conversationId: string;
  send: (event: RunProgressEventType) => void;
  now: () => number;
  startedAtMs: number;
  lastActivityAtMs: number;
  current: CurrentActivity;
}

type ActivityDeriver = (
  event: RunnerEvent,
  current: CurrentActivity,
) => CurrentActivity;

const INITIAL_ACTIVITY: CurrentActivity = { kind: "thinking" };

function fromActivityEvent(
  event: RunnerEvent,
  current: CurrentActivity,
): CurrentActivity {
  if (event.type !== "activity") return current;
  if (event.detail !== undefined)
    return { kind: event.kind, detail: event.detail };
  if (event.kind === current.kind) return current;
  return { kind: event.kind };
}

function fromToolUse(event: RunnerEvent): CurrentActivity {
  if (event.type !== "tool_use") return INITIAL_ACTIVITY;
  return { kind: "tool", detail: event.toolName };
}

const ACTIVITY_DERIVERS: Partial<Record<RunnerEvent["type"], ActivityDeriver>> =
  {
    activity: fromActivityEvent,
    assistant_text_delta: () => ({ kind: "responding" }),
    tool_use: fromToolUse,
    tool_result: () => INITIAL_ACTIVITY,
  };

function deriveActivity(
  event: RunnerEvent,
  current: CurrentActivity,
): CurrentActivity {
  const derive = ACTIVITY_DERIVERS[event.type];
  if (derive === undefined) return current;
  return derive(event, current);
}

function isSameActivity(a: CurrentActivity, b: CurrentActivity): boolean {
  return a.kind === b.kind && a.detail === b.detail;
}

function buildProgressEvent(state: ProgressState): RunProgressEventType {
  const nowMs = state.now();
  const event: RunProgressEventType = {
    type: EVENT_TYPES.RUN_PROGRESS,
    conversationId: state.conversationId,
    activity: state.current.kind,
    elapsedMs: nowMs - state.startedAtMs,
    idleMs: nowMs - state.lastActivityAtMs,
  };
  if (state.current.detail !== undefined) event.detail = state.current.detail;
  return event;
}

function observeEvent(state: ProgressState, event: RunnerEvent): void {
  state.lastActivityAtMs = state.now();
  const next = deriveActivity(event, state.current);
  if (isSameActivity(next, state.current)) return;
  state.current = next;
  state.send(buildProgressEvent(state));
}

/**
 * Starts reporting one turn's progress: at once, whenever what the agent is
 * doing changes, and on a heartbeat in between, so a long silent step — the
 * model composing a large file, a slow command — still shows as alive.
 */
export function startTurnProgress(options: TurnProgressOptions): TurnProgress {
  const now = options.now ?? Date.now;
  const startedAtMs = now();
  const state: ProgressState = {
    conversationId: options.conversationId,
    send: options.send,
    now,
    startedAtMs,
    lastActivityAtMs: startedAtMs,
    current: INITIAL_ACTIVITY,
  };
  state.send(buildProgressEvent(state));
  const heartbeat = setInterval(
    () => state.send(buildProgressEvent(state)),
    options.heartbeatMs ?? TURN_PROGRESS_HEARTBEAT_MS,
  );
  return {
    observe: (event) => observeEvent(state, event),
    stop: () => clearInterval(heartbeat),
  };
}
