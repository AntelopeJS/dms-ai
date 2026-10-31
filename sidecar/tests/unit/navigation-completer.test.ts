import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCKS_REPORT_GRACE_MS } from "../../src/constants/timing.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";

const TIMEOUT_MS = 3000;

describe("createNavigationCompleter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the landing when complete is called for the matching path", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor("/foo", TIMEOUT_MS);
    completer.complete("/foo");
    await expect(promise).resolves.toEqual({});
  });

  it("resolves null when the timeout elapses with no completion", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor("/foo", TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    await expect(promise).resolves.toBeNull();
  });

  it("resolves concurrent waits for distinct paths independently", async () => {
    const completer = createNavigationCompleter();
    const promiseA = completer.waitFor("/a", TIMEOUT_MS);
    const promiseB = completer.waitFor("/b", TIMEOUT_MS);
    completer.complete("/b");
    await expect(promiseB).resolves.toEqual({});
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    await expect(promiseA).resolves.toBeNull();
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
    await expect(first).resolves.toEqual({});
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    await expect(second).resolves.toBeNull();
  });

  it("hands the waiter the block report its host announced", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor("/foo", TIMEOUT_MS);
    completer.complete("/foo", { blocksWithinMs: 15_000 });
    const report = {
      status: "settled" as const,
      checked: 2,
      blocks: [{ type: "Chart", state: "empty" as const }],
    };
    completer.completeBlocks("/foo", report);
    const landing = await promise;
    await expect(landing?.blocks).resolves.toEqual(report);
  });

  it("keeps a report that arrives in the same tick as the landing", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor("/foo", TIMEOUT_MS);
    const report = { status: "settled" as const, checked: 0, blocks: [] };
    completer.complete("/foo", { blocksWithinMs: 15_000 });
    completer.completeBlocks("/foo", report);
    await expect((await promise)?.blocks).resolves.toEqual(report);
  });

  it("gives up on a report that never comes, after the time announced and some slack", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor("/foo", TIMEOUT_MS);
    completer.complete("/foo", { blocksWithinMs: 15_000 });
    const landing = await promise;
    await vi.advanceTimersByTimeAsync(15_000 + BLOCKS_REPORT_GRACE_MS + 1);
    await expect(landing?.blocks).resolves.toBeNull();
  });

  it("announces no report when the host did not", async () => {
    const completer = createNavigationCompleter();
    const promise = completer.waitFor("/foo", TIMEOUT_MS);
    completer.complete("/foo");
    await expect(promise).resolves.toEqual({});
  });

  it("holds no report waiter for a navigation nobody waits on", async () => {
    const completer = createNavigationCompleter();
    completer.complete("/foo", { blocksWithinMs: 15_000 });
    completer.completeBlocks("/foo", {
      status: "settled",
      checked: 0,
      blocks: [],
    });
    const waiter = completer.waitFor("/foo", TIMEOUT_MS);
    completer.complete("/foo", { blocksWithinMs: 15_000 });
    await vi.advanceTimersByTimeAsync(15_000 + BLOCKS_REPORT_GRACE_MS + 1);
    await expect((await waiter)?.blocks).resolves.toBeNull();
  });
});
