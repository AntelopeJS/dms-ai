import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIdleShutdownController } from "../../src/server/idle-shutdown.js";

const IDLE_MS = 1000;

describe("idle shutdown controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onIdle after idleMs when no connections", () => {
    let idle = 0;
    createIdleShutdownController({ idleMs: IDLE_MS, onIdle: () => idle++ });
    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(idle).toBe(0);
    vi.advanceTimersByTime(1);
    expect(idle).toBe(1);
  });

  it("does not idle while a connection is active", () => {
    let idle = 0;
    const controller = createIdleShutdownController({
      idleMs: IDLE_MS,
      onIdle: () => idle++,
    });
    controller.increment();
    vi.advanceTimersByTime(IDLE_MS * 5);
    expect(idle).toBe(0);
  });

  it("re-arms idle after the last connection closes", () => {
    let idle = 0;
    const controller = createIdleShutdownController({
      idleMs: IDLE_MS,
      onIdle: () => idle++,
    });
    controller.increment();
    controller.decrement();
    vi.advanceTimersByTime(IDLE_MS);
    expect(idle).toBe(1);
  });

  it("touch resets the idle countdown", () => {
    let idle = 0;
    const controller = createIdleShutdownController({
      idleMs: IDLE_MS,
      onIdle: () => idle++,
    });
    vi.advanceTimersByTime(IDLE_MS - 100);
    controller.touch();
    vi.advanceTimersByTime(IDLE_MS - 100);
    expect(idle).toBe(0);
    vi.advanceTimersByTime(100);
    expect(idle).toBe(1);
  });
});
