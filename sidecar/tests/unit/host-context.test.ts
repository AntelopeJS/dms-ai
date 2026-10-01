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
  it("states path, title, file and mode when all are known", () => {
    const block = formatHostContext(
      {
        path: "/form/form-simple",
        filepath: "/project/modules/demo/form-simple/page.ts",
        title: "Simple form",
      },
      "vibe",
    );
    expect(block).toBe(
      `${HOST_CONTEXT_OPEN}\n` +
        "page: /form/form-simple\n" +
        "title: Simple form\n" +
        "file: /project/modules/demo/form-simple/page.ts\n" +
        "mode: vibe\n" +
        HOST_CONTEXT_CLOSE,
    );
  });

  it("reads unknown for a title or file that could not be determined", () => {
    const block = formatHostContext({ path: "/dashboard" }, "safe");
    expect(block).toBe(
      `${HOST_CONTEXT_OPEN}\n` +
        "page: /dashboard\n" +
        "title: unknown\n" +
        "file: unknown\n" +
        "mode: safe\n" +
        HOST_CONTEXT_CLOSE,
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
