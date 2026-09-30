import { describe, expect, it } from "vitest";
import { createDisposalTracker } from "../../src/agent/disposals.js";

describe("disposal tracker", () => {
  it("settles past a teardown that rejects, without an unhandled rejection", async () => {
    const tracker = createDisposalTracker();
    const failed = Promise.reject(new Error("teardown failed"));
    tracker.track(failed);
    tracker.track(Promise.resolve());
    await expect(tracker.settle()).resolves.toBeUndefined();
    await expect(tracker.settle()).resolves.toBeUndefined();
  });
});
