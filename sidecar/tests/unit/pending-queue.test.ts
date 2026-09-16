import { describe, expect, it } from "vitest";
import { MAX_QUEUED_MESSAGES } from "../../src/protocol/messages.js";
import { createPendingQueueStore } from "../../src/server/pending-queue.js";

const CONV = "conv-1";
const item = (id: string) => ({ id, content: `c-${id}` });

describe("pending-queue store", () => {
  it("enqueues, reads, and shifts in FIFO order", () => {
    const q = createPendingQueueStore();
    q.enqueue(CONV, item("a"));
    q.enqueue(CONV, item("b"));
    expect(q.get(CONV).map((i) => i.id)).toEqual(["a", "b"]);
    expect(q.shift(CONV)?.id).toBe("a");
    expect(q.shift(CONV)?.id).toBe("b");
    expect(q.shift(CONV)).toBeNull();
  });

  it("cancels a specific item by id", () => {
    const q = createPendingQueueStore();
    q.enqueue(CONV, item("a"));
    q.enqueue(CONV, item("b"));
    q.enqueue(CONV, item("c"));
    q.cancel(CONV, "b");
    expect(q.get(CONV).map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("isolates queues per conversation", () => {
    const q = createPendingQueueStore();
    q.enqueue("x", item("a"));
    q.enqueue("y", item("b"));
    expect(q.get("x").map((i) => i.id)).toEqual(["a"]);
    expect(q.get("y").map((i) => i.id)).toEqual(["b"]);
  });

  it("clear empties a conversation's queue", () => {
    const q = createPendingQueueStore();
    q.enqueue(CONV, item("a"));
    q.clear(CONV);
    expect(q.get(CONV)).toEqual([]);
    expect(q.shift(CONV)).toBeNull();
  });

  it("caps the queue at MAX_QUEUED_MESSAGES", () => {
    const q = createPendingQueueStore();
    for (let n = 0; n < MAX_QUEUED_MESSAGES + 5; n++) {
      q.enqueue(CONV, item(`i${n}`));
    }
    expect(q.get(CONV).length).toBe(MAX_QUEUED_MESSAGES);
  });

  it("is a single-writer drain lock: only one holder at a time", () => {
    const q = createPendingQueueStore();
    expect(q.tryStartDrain(CONV)).toBe(true);
    // A second acquire while held is refused — this is what prevents a racing
    // or reconnecting client from starting a parallel drain and double-running.
    expect(q.tryStartDrain(CONV)).toBe(false);
    q.endDrain(CONV);
    expect(q.tryStartDrain(CONV)).toBe(true);
    q.endDrain(CONV);
  });

  it("scopes the drain lock per conversation", () => {
    const q = createPendingQueueStore();
    expect(q.tryStartDrain("x")).toBe(true);
    expect(q.tryStartDrain("y")).toBe(true);
    q.endDrain("x");
    q.endDrain("y");
  });
});
