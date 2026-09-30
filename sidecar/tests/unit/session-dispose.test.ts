import { describe, expect, it } from "vitest";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { createAgentSession } from "../../src/agent/session.js";
import { defer, flushCallbacks, watchSettle } from "../helpers/deferred.js";

const IDLE_TIMEOUT_MS = 1_000;

interface SessionSetup {
  close: () => Promise<void>;
  events?: AsyncIterator<RunnerEvent, void>;
  onDisposed?: (disposal: Promise<void>) => void;
}

// A backend that never says anything: whatever the session does, it is not
// because an event arrived.
function silentEvents(): AsyncIterator<RunnerEvent, void> {
  return { next: () => new Promise<never>(() => {}) };
}

// A backend whose stream has already ended, as when its process died.
function endedEvents(): AsyncIterator<RunnerEvent, void> {
  return { next: () => Promise.resolve({ value: undefined, done: true }) };
}

function buildSession(setup: SessionSetup) {
  return createAgentSession({
    events: setup.events ?? silentEvents(),
    controls: {
      submitTurn: () => {},
      interrupt: () => {},
      close: setup.close,
    },
    abortController: new AbortController(),
    onDisposed: setup.onDisposed ?? (() => {}),
  });
}

describe("session teardown", () => {
  it("resolves dispose only once the backend has released everything", async () => {
    const released = defer();
    const session = buildSession({ close: () => released.promise });

    const disposal = watchSettle(session.dispose());
    await flushCallbacks();
    expect(disposal.isSettled()).toBe(false);

    released.resolve();
    await flushCallbacks();
    expect(disposal.isSettled()).toBe(true);
  });

  it("hands every caller the same teardown, and closes the backend once", async () => {
    const released = defer();
    let closes = 0;
    const session = buildSession({
      close: () => {
        closes += 1;
        return released.promise;
      },
    });

    const first = session.dispose();
    const second = session.dispose();
    expect(second).toBe(first);
    expect(closes).toBe(1);
    released.resolve();
    await first;
  });

  it("hands the teardown of a session that ends on its own to onDisposed", async () => {
    const released = defer();
    const handed: Promise<void>[] = [];
    const session = buildSession({
      close: () => released.promise,
      events: endedEvents(),
      onDisposed: (disposal) => handed.push(disposal),
    });

    for await (const _ of session.sendTurn(
      { text: "go", attachments: [] },
      IDLE_TIMEOUT_MS,
    )) {
      // The stream has already ended: the turn only has to notice.
    }
    expect(handed).toHaveLength(1);
    expect(session.dispose()).toBe(handed[0]);
    released.resolve();
    await handed[0];
  });
});
