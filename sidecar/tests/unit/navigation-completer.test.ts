import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";

const TIMEOUT_MS = 3000;

describe("createNavigationCompleter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves true when complete is called for the matching path", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor("/foo", TIMEOUT_MS);
    completer.complete("/foo");
    await expect(promise).resolves.toBe(true);
  });

  it("resolves false when the timeout elapses with no completion", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor("/foo", TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    await expect(promise).resolves.toBe(false);
  });

  it("resolves concurrent waits for distinct paths independently", async () => {
    const completer = createNavigationCompleter();
    const promiseA = completer.waitFor("/a", TIMEOUT_MS);
    const promiseB = completer.waitFor("/b", TIMEOUT_MS);
    completer.complete("/b");
    await expect(promiseB).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    await expect(promiseA).resolves.toBe(false);
  });

  it("ignores complete calls for paths with no pending wait", () => {
    const completer = createNavigationCompleter();
    expect(() => completer.complete("/missing")).not.toThrow();
  });

  it("matches multiple sequential waits for the same path one-by-one", async () => {
    const completer = createNavigationCompleter();
    const first = completer.waitFor("/foo", TIMEOUT_MS);
    const second = completer.waitFor("/foo", TIMEOUT_MS);
    completer.complete("/foo");
    await expect(first).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    await expect(second).resolves.toBe(false);
  });
});
