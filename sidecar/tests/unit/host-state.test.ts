import { describe, expect, it } from "vitest";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { createHostState } from "../../src/state/host-state.js";

describe("createHostState", () => {
  it("defaults to the unknown page", () => {
    const state = createHostState();
    expect(state.getCurrentPage()).toEqual({ path: UNKNOWN_PAGE_PATH });
  });

  it("setCurrentPage updates the value returned by getCurrentPage", () => {
    const state = createHostState();
    const page = {
      path: "/about",
      filepath: "pages/about.vue",
      title: "About",
    };
    state.setCurrentPage(page);
    expect(state.getCurrentPage()).toEqual(page);
  });

  it("supports multiple successive updates", () => {
    const state = createHostState();
    state.setCurrentPage({ path: "/a" });
    state.setCurrentPage({ path: "/b", filepath: "pages/b.vue" });
    expect(state.getCurrentPage()).toEqual({
      path: "/b",
      filepath: "pages/b.vue",
    });
  });
});
