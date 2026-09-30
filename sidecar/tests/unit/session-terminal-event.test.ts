import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { createAgentSession } from "../../src/agent/session.js";
import {
  idleTimeoutReason,
  toolCapReason,
} from "../../src/agent/turn-end-reasons.js";
import {
  INTERRUPT_FALLBACK_MS,
  TURN_SESSION_CLOSED_MESSAGE,
  TURN_STREAM_ENDED_MESSAGE,
} from "../../src/constants/agent.js";
import { TOOL_EXECUTION_CAP_MS } from "../../src/constants/timing.js";

const IDLE_TIMEOUT_MS = 50;
const PROVIDER_ABORT_MESSAGE = "Claude Code process aborted by user";
const TOOL_USE: RunnerEvent = {
  type: "tool_use",
  callId: "call-1",
  toolName: "Bash",
  args: { command: "pnpm install" },
};
const TOOL_RESULT: RunnerEvent = {
  type: "tool_result",
  callId: "call-1",
  result: "done",
  isError: false,
};
const TOOL_PROGRESS: RunnerEvent = {
  type: "activity",
  kind: "tool",
  detail: "Bash",
};

const TOOL_PROGRESS_STEP_MS = TOOL_EXECUTION_CAP_MS / 4;
const TOOL_PROGRESS_REPORTS = 8;

interface ScriptedEvent {
  event: RunnerEvent;
  delayMs: number;
}

function immediate(event: RunnerEvent): ScriptedEvent {
  return { event, delayMs: 0 };
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(new Error(PROVIDER_ABORT_MESSAGE));
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () =>
      reject(new Error(PROVIDER_ABORT_MESSAGE)),
    );
  });
}

function deliver(
  scripted: ScriptedEvent,
  signal: AbortSignal,
): Promise<IteratorResult<RunnerEvent, void>> {
  const delivered = new Promise<IteratorResult<RunnerEvent, void>>((resolve) =>
    setTimeout(
      () => resolve({ value: scripted.event, done: false }),
      scripted.delayMs,
    ),
  );
  return Promise.race([delivered, waitForAbort(signal)]);
}

/**
 * A provider stream the test drives by hand: replays `events` on their delays,
 * then either ends or waits, and rejects the pending read once the session
 * aborts, the way the SDK does.
 */
function scriptedEvents(
  events: ScriptedEvent[],
  signal: AbortSignal,
  endsAfterScript: boolean,
): AsyncIterator<RunnerEvent, void> {
  const queue = [...events];
  return {
    next: () => {
      const scripted = queue.shift();
      if (scripted !== undefined) return deliver(scripted, signal);
      if (endsAfterScript)
        return Promise.resolve({ value: undefined, done: true });
      return waitForAbort(signal);
    },
  };
}

function buildSession(events: ScriptedEvent[], endsAfterScript: boolean) {
  const abortController = new AbortController();
  const session = createAgentSession({
    events: scriptedEvents(events, abortController.signal, endsAfterScript),
    controls: { submitTurn: () => {}, interrupt: () => {}, close: () => {} },
    abortController,
    onDisposed: () => {},
  });
  return { session, abortController };
}

async function drain(
  session: ReturnType<typeof buildSession>["session"],
  seen: RunnerEvent[],
  idleTimeoutMs = IDLE_TIMEOUT_MS,
): Promise<void> {
  for await (const event of session.sendTurn(
    { text: "go", attachments: [] },
    idleTimeoutMs,
  )) {
    seen.push(event);
  }
}

describe("every turn ends with a terminal event", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports an error when the provider stream ends before done", async () => {
    const { session } = buildSession(
      [immediate(TOOL_USE), immediate(TOOL_RESULT)],
      true,
    );
    const seen: RunnerEvent[] = [];
    await drain(session, seen);
    expect(seen.at(-1)).toEqual({
      type: "error",
      message: TURN_STREAM_ENDED_MESSAGE,
    });
  });

  it("says the session was closed when it is disposed mid-turn", async () => {
    const { session } = buildSession([], false);
    const seen: RunnerEvent[] = [];
    const running = drain(session, seen);
    session.dispose();
    await running;
    expect(seen).toEqual([
      { type: "error", message: TURN_SESSION_CLOSED_MESSAGE },
    ]);
  });

  it("ends a stop the provider ignored as done, not as an error", async () => {
    vi.useFakeTimers();
    const { session, abortController } = buildSession([], false);
    const seen: RunnerEvent[] = [];
    const running = drain(session, seen, INTERRUPT_FALLBACK_MS * 2);
    await vi.advanceTimersByTimeAsync(0);
    session.interrupt();
    await vi.advanceTimersByTimeAsync(INTERRUPT_FALLBACK_MS + 1);
    await running;
    expect(abortController.signal.aborted).toBe(true);
    expect(seen).toEqual([{ type: "done" }]);
  });

  it("names the idle window it waited for", async () => {
    vi.useFakeTimers();
    const { session } = buildSession([], false);
    const seen: RunnerEvent[] = [];
    const running = drain(session, seen);
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 1);
    await running;
    expect(seen).toEqual([
      { type: "error", message: idleTimeoutReason(IDLE_TIMEOUT_MS) },
    ]);
  });

  it("does not let a running tool's own progress extend the tool cap", async () => {
    vi.useFakeTimers();
    const progress = Array.from({ length: TOOL_PROGRESS_REPORTS }, () => ({
      event: TOOL_PROGRESS,
      delayMs: TOOL_PROGRESS_STEP_MS,
    }));
    const { session, abortController } = buildSession(
      [immediate(TOOL_USE), ...progress],
      false,
    );
    const seen: RunnerEvent[] = [];
    const running = drain(session, seen);
    await vi.advanceTimersByTimeAsync(TOOL_EXECUTION_CAP_MS + 1);
    await running;
    expect(abortController.signal.aborted).toBe(true);
    expect(
      seen.filter((event) => event.type === "activity").length,
    ).toBeLessThan(TOOL_PROGRESS_REPORTS);
    expect(seen.at(-1)).toEqual({
      type: "error",
      message: toolCapReason(TOOL_EXECUTION_CAP_MS),
    });
  });
});
