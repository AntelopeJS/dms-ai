import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// The fake binary is plain JS, like the real one: it shares no module with the
// sidecar, so its loader is exercised on its own here.
import { loadDump } from "../fixtures/mock-codex/src/dump.mjs";

const DUMPS = resolve(import.meta.dirname, "../fixtures/codex-dumps");
const SIMPLE = resolve(DUMPS, "recette-1-simple-message.jsonl");
const DENIED = resolve(DUMPS, "recette-3-command-denied.jsonl");

interface Frame {
  id?: number;
  method?: string;
}

function methodsOf(turn: Frame[]): string[] {
  return turn.map((frame) => frame.method ?? "");
}

describe("mock-codex dump loader", () => {
  it("replays the responses the capture recorded, matched by method", () => {
    const { responses } = loadDump(SIMPLE);
    const started = responses.get("thread/start") as {
      thread: { id: string };
    };
    expect(typeof started.thread.id).toBe("string");
    expect(responses.has("initialize")).toBe(true);
  });

  it("cuts one turn per recorded turn/start, ending on turn/completed", () => {
    const { turns } = loadDump(SIMPLE);
    expect(turns).toHaveLength(1);
    expect(methodsOf(turns[0] as Frame[]).at(-1)).toBe("turn/completed");
  });

  it("keeps the server requests a turn contains, and drops our own replies", () => {
    const [turn] = loadDump(DENIED).turns as Frame[][];
    const approvals = (turn ?? []).filter(
      (frame) => frame.method === "item/commandExecution/requestApproval",
    );
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.id).toBeDefined();
    // A reply to one of the client's own calls carries an id and no method;
    // replaying it would answer a request nobody made.
    expect(
      (turn ?? []).some(
        (frame) => frame.id !== undefined && frame.method === undefined,
      ),
    ).toBe(false);
  });

  it("concatenates turns across files so one script can replay several", () => {
    const { turns } = loadDump(`${SIMPLE},${DENIED}`);
    expect(turns).toHaveLength(2);
  });

  it("repeats a file to replay the same turn twice", () => {
    const { turns } = loadDump(`${DENIED},${DENIED}`);
    expect(turns).toHaveLength(2);
    expect(methodsOf(turns[0] as Frame[])).toEqual(
      methodsOf(turns[1] as Frame[]),
    );
  });
});
