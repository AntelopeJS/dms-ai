import { describe, expect, it } from "vitest";
import type { ActiveTurn } from "../../src/server/turn-registry.js";
import { turnTypecheck } from "../../src/server/turns.js";

function turn(overrides: Partial<ActiveTurn>): ActiveTurn {
  return {
    typecheck: "skipped",
    builderOps: 0,
    mutatingCallIds: [],
    ...overrides,
  } as ActiveTurn;
}

describe("turnTypecheck", () => {
  it("counts a turn changed by Builder operations alone as typechecked", () => {
    expect(
      turnTypecheck(turn({ builderOps: 2, mutatingCallIds: ["a", "b"] })),
    ).toBe("passed");
  });

  it("keeps skipped when a raw edit or a failed operation took part", () => {
    expect(
      turnTypecheck(turn({ builderOps: 1, mutatingCallIds: ["a", "edit"] })),
    ).toBe("skipped");
  });

  it("keeps the outcome of a typecheck that ran", () => {
    expect(
      turnTypecheck(
        turn({ typecheck: "failed", builderOps: 1, mutatingCallIds: ["a"] }),
      ),
    ).toBe("failed");
  });
});
