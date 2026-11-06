import { describe, expect, it } from "vitest";
import {
  createRepeatConfirmationGate,
  REPEAT_CONFIRMATION_WINDOW_MS,
} from "../../src/mcp/tools/repeat-confirmation-gate.js";

function clock() {
  const state = { now: 1_000 };
  return { state, now: () => state.now };
}

describe("createRepeatConfirmationGate", () => {
  it("lets a call the chat would not hold through at once", async () => {
    const gate = createRepeatConfirmationGate();
    expect(await gate("builder_add_block", { pageRef: "/home" })).toEqual({
      isAllowed: true,
    });
  });

  it("refuses a deletion once with what it would do, then runs the identical repeat", async () => {
    const gate = createRepeatConfirmationGate();
    const first = await gate("builder_delete_resource", { ref: "orders" });
    expect(first.isAllowed).toBe(false);
    expect(first.message).toContain('"ref":"orders"');
    expect(await gate("builder_delete_resource", { ref: "orders" })).toEqual({
      isAllowed: true,
    });
  });

  it("treats the same arguments in another key order as the same call", async () => {
    const gate = createRepeatConfirmationGate();
    await gate("builder_delete_resource", { ref: "orders", keepData: true });
    const repeat = await gate("builder_delete_resource", {
      keepData: true,
      ref: "orders",
    });
    expect(repeat.isAllowed).toBe(true);
  });

  it("confirms one run only: a third identical call asks again", async () => {
    const gate = createRepeatConfirmationGate();
    await gate("builder_delete_resource", { ref: "orders" });
    await gate("builder_delete_resource", { ref: "orders" });
    const third = await gate("builder_delete_resource", { ref: "orders" });
    expect(third.isAllowed).toBe(false);
  });

  it("asks again when the repeat comes after the window", async () => {
    const { state, now } = clock();
    const gate = createRepeatConfirmationGate(now);
    await gate("builder_delete_resource", { ref: "orders" });
    state.now += REPEAT_CONFIRMATION_WINDOW_MS + 1;
    const late = await gate("builder_delete_resource", { ref: "orders" });
    expect(late.isAllowed).toBe(false);
  });

  it("asks again when a mapping's previewed page removals changed since", async () => {
    const gate = createRepeatConfirmationGate();
    const mapping = { connection: "erp" };
    const first = await gate("builder_map_resources", {
      ...mapping,
      pagesToRemove: ["/orders"],
    });
    expect(first.message).toContain("/orders");
    const changed = await gate("builder_map_resources", {
      ...mapping,
      pagesToRemove: ["/orders", "/invoices"],
    });
    expect(changed.isAllowed).toBe(false);
    expect(changed.message).toContain("/invoices");
  });

  it("lets a mapping that removes no page through at once", async () => {
    const gate = createRepeatConfirmationGate();
    const decision = await gate("builder_map_resources", {
      connection: "erp",
      pagesToRemove: [],
    });
    expect(decision.isAllowed).toBe(true);
  });
});
