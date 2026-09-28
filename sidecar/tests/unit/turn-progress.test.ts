import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunProgressEventType } from "../../src/protocol/events.js";
import {
  startTurnProgress,
  type TurnProgress,
} from "../../src/server/turn-progress.js";

const CONVERSATION_ID = "conv-progress-1";
const HEARTBEAT_MS = 1_000;
const QUIET_MS = 2_500;

describe("turn progress reporting", () => {
  let sent: RunProgressEventType[];
  let progress: TurnProgress;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    progress = startTurnProgress({
      conversationId: CONVERSATION_ID,
      send: (event) => sent.push(event),
      heartbeatMs: HEARTBEAT_MS,
    });
  });

  afterEach(() => {
    progress.stop();
    vi.useRealTimers();
  });

  it("reports the turn as soon as it starts", () => {
    expect(sent).toEqual([
      {
        type: "run_progress",
        conversationId: CONVERSATION_ID,
        activity: "thinking",
        elapsedMs: 0,
        idleMs: 0,
      },
    ]);
  });

  it("reports a change of activity at once, and only once", () => {
    progress.observe({ type: "activity", kind: "writing", detail: "Write" });
    progress.observe({ type: "activity", kind: "writing" });
    progress.observe({ type: "activity", kind: "writing" });
    expect(sent.map((event) => [event.activity, event.detail])).toEqual([
      ["thinking", undefined],
      ["writing", "Write"],
    ]);
  });

  it("follows tools and streamed text", () => {
    progress.observe({
      type: "tool_use",
      callId: "call-1",
      toolName: "Bash",
      args: {},
    });
    progress.observe({
      type: "tool_result",
      callId: "call-1",
      result: "ok",
      isError: false,
    });
    progress.observe({ type: "assistant_text_delta", text: "Done" });
    expect(sent.map((event) => [event.activity, event.detail])).toEqual([
      ["thinking", undefined],
      ["tool", "Bash"],
      ["thinking", undefined],
      ["responding", undefined],
    ]);
  });

  it("keeps beating while nothing happens, with the time since the last activity", async () => {
    progress.observe({ type: "activity", kind: "writing", detail: "Write" });
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    const heartbeats = sent.slice(2);
    expect(heartbeats).toHaveLength(2);
    expect(heartbeats.at(-1)).toMatchObject({
      activity: "writing",
      detail: "Write",
      elapsedMs: 2 * HEARTBEAT_MS,
      idleMs: 2 * HEARTBEAT_MS,
    });
  });

  it("stops beating once the turn is over", async () => {
    progress.stop();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(sent).toHaveLength(1);
  });
});
