import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { createAgentSession } from "../../src/agent/session.js";
import { TOOL_EXECUTION_CAP_MS } from "../../src/constants/timing.js";

const IDLE_TIMEOUT_MS = 50;
const TOOL_USE: RunnerEvent = {
  type: "tool_use",
  callId: "call-1",
  toolName: "Bash",
  args: { command: "sleep infinity" },
};

// Emits one tool_use, then goes silent for good — the shape of a tool whose
// result never comes back.
function buildStalledEvents(): AsyncIterator<RunnerEvent, void> {
  let emitted = false;
  return {
    next: () => {
      if (emitted) return new Promise<never>(() => {});
      emitted = true;
      return Promise.resolve({ value: TOOL_USE, done: false });
    },
  };
}

function buildSession(abortController: AbortController) {
  return createAgentSession({
    events: buildStalledEvents(),
    controls: {
      submitTurn: () => {},
      interrupt: () => {},
      close: () => {},
    },
    abortController,
    onDisposed: () => {},
  });
}

// Consumes without ever leaving the loop: returning early would end the
// generator and disarm the timer under test.
async function drain(
  session: ReturnType<typeof buildSession>,
  seen: RunnerEvent[],
): Promise<void> {
  for await (const event of session.sendTurn(
    { text: "go", attachments: [] },
    IDLE_TIMEOUT_MS,
  )) {
    seen.push(event);
  }
}

describe("outstanding tool cap", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the idle timer suspended while a tool is outstanding", async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    const session = buildSession(abortController);
    const seen: RunnerEvent[] = [];
    void drain(session, seen);
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS * 10);
    expect(seen).toEqual([TOOL_USE]);
    expect(abortController.signal.aborted).toBe(false);
    session.dispose();
  });

  it("aborts once the tool has held the timer past the cap", async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    const session = buildSession(abortController);
    const seen: RunnerEvent[] = [];
    void drain(session, seen);
    await vi.advanceTimersByTimeAsync(TOOL_EXECUTION_CAP_MS + 1);
    expect(abortController.signal.aborted).toBe(true);
    session.dispose();
  });
});
