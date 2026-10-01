import { describe, expect, it } from "vitest";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { createHostState } from "../../src/state/host-state.js";

const ABOUT_FILE = "/project/pages/about.vue";

describe("createHostState", () => {
  it("defaults to the unknown page", () => {
    const state = createHostState();
    expect(state.getCurrentPage()).toEqual({ path: UNKNOWN_PAGE_PATH });
  });

  it("setCurrentPage updates the value returned by getCurrentPage", async () => {
    const state = createHostState();
    await state.setCurrentPage({ path: "/about", title: "About" });
    expect(state.getCurrentPage()).toEqual({ path: "/about", title: "About" });
  });

  it("adds the source file resolved from the route", async () => {
    const state = createHostState({
      resolveFilepath: async (path) =>
        path === "/about" ? ABOUT_FILE : undefined,
    });
    await state.setCurrentPage({ path: "/about", title: "About" });
    expect(state.getCurrentPage()).toEqual({
      path: "/about",
      title: "About",
      filepath: ABOUT_FILE,
    });
    await state.setCurrentPage({ path: "/unregistered" });
    expect(state.getCurrentPage()).toEqual({ path: "/unregistered" });
  });

  it("drops a file resolved for a page the host has already left", async () => {
    let releaseFirst = (): void => {};
    const firstResolution = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const state = createHostState({
      resolveFilepath: async (path) => {
        if (path === "/slow") await firstResolution;
        return `/project${path}.vue`;
      },
    });
    const slow = state.setCurrentPage({ path: "/slow" });
    await state.setCurrentPage({ path: "/fast" });
    releaseFirst();
    await slow;
    expect(state.getCurrentPage()).toEqual({
      path: "/fast",
      filepath: "/project/fast.vue",
    });
  });
});
