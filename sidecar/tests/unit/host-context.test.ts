import { describe, expect, it } from "vitest";
import {
  formatHostContext,
  prependHostContext,
} from "../../src/agent/host-context.js";
import {
  HOST_CONTEXT_CLOSE,
  HOST_CONTEXT_OPEN,
} from "../../src/constants/agent.js";

describe("host context block", () => {
  it("states path, file, title and mode when all are known", () => {
    const block = formatHostContext(
      {
        path: "/form/form-simple",
        filepath: "modules/demo/form-simple/page.ts",
        title: "Simple form",
      },
      "vibe",
    );
    expect(block).toBe(
      `${HOST_CONTEXT_OPEN}\n` +
        "page: /form/form-simple\n" +
        "file: modules/demo/form-simple/page.ts\n" +
        "title: Simple form\n" +
        "mode: vibe\n" +
        HOST_CONTEXT_CLOSE,
    );
  });

  it("omits the file and title lines when absent but always states the mode", () => {
    const block = formatHostContext({ path: "/dashboard" }, "safe");
    expect(block).toBe(
      `${HOST_CONTEXT_OPEN}\npage: /dashboard\nmode: safe\n${HOST_CONTEXT_CLOSE}`,
    );
  });

  it("prepends the block above the user's message", () => {
    const grounded = prependHostContext(
      "add a chart",
      { path: "/overview" },
      "vibe",
    );
    expect(grounded.startsWith(HOST_CONTEXT_OPEN)).toBe(true);
    expect(grounded.endsWith("add a chart")).toBe(true);
    expect(grounded).toContain("page: /overview");
    expect(grounded).toContain("mode: vibe");
  });
});
