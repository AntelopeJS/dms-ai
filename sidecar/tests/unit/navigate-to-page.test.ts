import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  NAVIGATE_RESULT_COMPLETED_SUFFIX,
  NAVIGATE_RESULT_TIMEOUT_SUFFIX,
  NAVIGATE_TOOL_NAME,
  NAVIGATE_UNKNOWN_ROUTE_PREFIX,
} from "../../src/constants/mcp.js";
import { NAVIGATE_TIMEOUT_MS } from "../../src/constants/timing.js";
import { buildNavigateToPageTool } from "../../src/mcp/tools/navigate-to-page.js";
import type { RegistryClient } from "../../src/pages/registry-client.js";
import type { PagesRegistryEntry } from "../../src/pages/types.js";
import {
  type AnyServerEventType,
  EVENT_TYPES,
} from "../../src/protocol/events.js";
import {
  createNavigationCompleter,
  type NavigationCompleter,
} from "../../src/server/navigation-completer.js";

interface SpyDeps {
  calls: AnyServerEventType[];
  sendToHost: (event: AnyServerEventType) => void;
  navigationCompleter: NavigationCompleter;
  registry: RegistryClient;
  getCurrentPage: () => { path: string };
}

const STUB_CURRENT_PAGE = { path: "/stub-current" };

const ResultPayload = z.object({
  data: z.record(z.string(), z.unknown()),
  message: z.string(),
});

function payloadOf(result: { content: { text: string }[] }) {
  return ResultPayload.parse(JSON.parse(result.content[0]?.text ?? ""));
}

function buildRegistry(paths: string[]): RegistryClient {
  const entries: PagesRegistryEntry[] = paths.map((path, i) => ({
    id: `page-${i}`,
    path,
    moduleId: "dms",
  }));
  return {
    getRegistry: async () => entries,
    getStaleSinceMs: () => null,
    invalidate: () => {},
  };
}

/** Empty registry → validation fails open (navigation always proceeds). */
function buildSpyDeps(routes: string[] = []): SpyDeps {
  const calls: AnyServerEventType[] = [];
  return {
    calls,
    sendToHost: (event) => {
      calls.push(event);
    },
    navigationCompleter: createNavigationCompleter(),
    registry: buildRegistry(routes),
    getCurrentPage: () => STUB_CURRENT_PAGE,
  };
}

function buildTool(deps: SpyDeps) {
  return buildNavigateToPageTool({
    sendToHost: deps.sendToHost,
    navigationCompleter: deps.navigationCompleter,
    registry: deps.registry,
    getCurrentPage: deps.getCurrentPage,
  });
}

/**
 * Let the handler progress past its async registry-validation step so the
 * navigation waiter is registered before we complete it.
 */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("buildNavigateToPageTool", () => {
  it("registers under the navigate_to_page name", () => {
    const deps = buildSpyDeps();
    const toolDef = buildTool(deps);
    expect(toolDef.name).toBe(NAVIGATE_TOOL_NAME);
  });

  it("sends a host_command_navigate event with the requested path", async () => {
    const deps = buildSpyDeps();
    const toolDef = buildTool(deps);
    const promise = toolDef.handler({ path: "/dashboard/settings" });
    await tick();
    deps.navigationCompleter.complete("/dashboard/settings");
    await promise;
    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0]).toEqual({
      type: EVENT_TYPES.HOST_COMMAND_NAVIGATE,
      path: "/dashboard/settings",
    });
  });

  it("returns the completed suffix when navigation confirms", async () => {
    const deps = buildSpyDeps();
    const toolDef = buildTool(deps);
    const promise = toolDef.handler({ path: "/about" });
    await tick();
    deps.navigationCompleter.complete("/about");
    const result = await promise;
    const payload = JSON.parse(result.content[0]?.text ?? "");
    expect(payload.ok).toBe(true);
    expect(payload.data.path).toBe("/about");
    expect(payload.data.navigation).toBe("completed");
    expect(payload.data.currentPage).toEqual(STUB_CURRENT_PAGE);
    expect(payload.message).toContain(NAVIGATE_RESULT_COMPLETED_SUFFIX);
    expect(payload.message).toContain(STUB_CURRENT_PAGE.path);
  });

  it("returns the timeout suffix when no completion arrives", async () => {
    vi.useFakeTimers();
    try {
      const deps = buildSpyDeps();
      const toolDef = buildTool(deps);
      const promise = toolDef.handler({ path: "/never" });
      await vi.advanceTimersByTimeAsync(NAVIGATE_TIMEOUT_MS + 1);
      const result = await promise;
      const payload = JSON.parse(result.content[0]?.text ?? "");
      expect(payload.ok).toBe(true);
      expect(payload.data.path).toBe("/never");
      expect(payload.data.navigation).toBe("timeout");
      expect(payload.message).toContain(NAVIGATE_RESULT_TIMEOUT_SUFFIX);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to navigate to a route not in a non-empty registry", async () => {
    const deps = buildSpyDeps(["/form/form-simple", "/examples/overview"]);
    const toolDef = buildTool(deps);
    const result = await toolDef.handler({ path: "/pages?" });
    const payload = JSON.parse(result.content[0]?.text ?? "");
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("unknown_route");
    expect(payload.message.startsWith(NAVIGATE_UNKNOWN_ROUTE_PREFIX)).toBe(
      true,
    );
    expect(payload.error.suggestions).toContain("/form/form-simple");
    expect(deps.calls).toHaveLength(0);
  });

  it("navigates to a known route (ignoring a trailing slash)", async () => {
    const deps = buildSpyDeps(["/form/form-simple"]);
    const toolDef = buildTool(deps);
    const promise = toolDef.handler({ path: "/form/form-simple/" });
    await tick();
    deps.navigationCompleter.complete("/form/form-simple/");
    await promise;
    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0]).toEqual({
      type: EVENT_TYPES.HOST_COMMAND_NAVIGATE,
      path: "/form/form-simple/",
    });
  });

  describe("block health", () => {
    const BLOCKS_WITHIN_MS = 15_000;
    const REPORT = {
      status: "settled" as const,
      checked: 7,
      blocks: [
        { path: "revenueCard", type: "ChartCard", state: "empty" as const },
        { path: "ordersKpi", type: "KpiCard", state: "error" as const },
      ],
    };

    it("lists the blocks the host reported as empty or failed", async () => {
      const deps = buildSpyDeps();
      const promise = buildTool(deps).handler({ path: "/sales" });
      await tick();
      deps.navigationCompleter.complete("/sales", {
        blocksWithinMs: BLOCKS_WITHIN_MS,
      });
      await tick();
      deps.navigationCompleter.completeBlocks("/sales", REPORT);
      const payload = payloadOf(await promise);
      expect(payload.data).toMatchObject({
        blocks: {
          checked: 7,
          settled: true,
          empty: [{ path: "revenueCard", type: "ChartCard" }],
          error: [{ path: "ordersKpi", type: "KpiCard" }],
          loading: [],
        },
      });
      expect(payload.message).toMatch(
        /revenueCard \(ChartCard\).*ordersKpi \(KpiCard\)/,
      );
    });

    it("waits for the report, which the host sends once its blocks settled", async () => {
      vi.useFakeTimers();
      try {
        const deps = buildSpyDeps();
        let settled = false;
        const promise = buildTool(deps)
          .handler({ path: "/sales" })
          .then((result) => {
            settled = true;
            return result;
          });
        await vi.advanceTimersByTimeAsync(1);
        deps.navigationCompleter.complete("/sales", {
          blocksWithinMs: BLOCKS_WITHIN_MS,
        });
        await vi.advanceTimersByTimeAsync(BLOCKS_WITHIN_MS);
        expect(settled).toBe(false);
        deps.navigationCompleter.completeBlocks("/sales", REPORT);
        await promise;
        expect(settled).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("answers without block health when the host never reports", async () => {
      vi.useFakeTimers();
      try {
        const deps = buildSpyDeps();
        const promise = buildTool(deps).handler({ path: "/sales" });
        await vi.advanceTimersByTimeAsync(1);
        deps.navigationCompleter.complete("/sales", {
          blocksWithinMs: BLOCKS_WITHIN_MS,
        });
        await vi.advanceTimersByTimeAsync(BLOCKS_WITHIN_MS + 5_000);
        const payload = payloadOf(await promise);
        expect(payload.data).toMatchObject({ navigation: "completed" });
        expect(payload.data).not.toHaveProperty("blocks");
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not wait when the host did not announce a report", async () => {
      const deps = buildSpyDeps();
      const promise = buildTool(deps).handler({ path: "/sales" });
      await tick();
      deps.navigationCompleter.complete("/sales");
      const payload = payloadOf(await promise);
      expect(payload.data).not.toHaveProperty("blocks");
    });

    it("says what is still loading when the host gave up waiting", async () => {
      const deps = buildSpyDeps();
      const promise = buildTool(deps).handler({ path: "/sales" });
      await tick();
      deps.navigationCompleter.complete("/sales", {
        blocksWithinMs: BLOCKS_WITHIN_MS,
      });
      await tick();
      deps.navigationCompleter.completeBlocks("/sales", {
        status: "timeout",
        checked: 3,
        blocks: [{ path: "slowChart", type: "Chart", state: "loading" }],
      });
      const payload = payloadOf(await promise);
      expect(payload.data).toMatchObject({
        blocks: {
          settled: false,
          loading: [{ path: "slowChart", type: "Chart" }],
        },
      });
      expect(payload.message).toContain("Still loading");
    });

    it("says every block rendered when none is empty, failed or loading", async () => {
      const deps = buildSpyDeps();
      const promise = buildTool(deps).handler({ path: "/sales" });
      await tick();
      deps.navigationCompleter.complete("/sales", {
        blocksWithinMs: BLOCKS_WITHIN_MS,
      });
      await tick();
      deps.navigationCompleter.completeBlocks("/sales", {
        status: "settled",
        checked: 4,
        blocks: [],
      });
      const payload = payloadOf(await promise);
      expect(payload.data).toMatchObject({
        blocks: { checked: 4, empty: [] },
      });
      expect(payload.message).toContain("all 4 data blocks");
    });

    it("lists a block once when its parent card is already listed", async () => {
      const deps = buildSpyDeps();
      const promise = buildTool(deps).handler({ path: "/sales" });
      await tick();
      deps.navigationCompleter.complete("/sales", {
        blocksWithinMs: BLOCKS_WITHIN_MS,
      });
      await tick();
      deps.navigationCompleter.completeBlocks("/sales", {
        status: "settled",
        checked: 2,
        blocks: [
          { path: "revenue", type: "ChartCard", state: "empty" },
          { path: "revenue.plot", type: "Chart", state: "empty" },
        ],
      });
      const payload = payloadOf(await promise);
      expect(payload.data).toMatchObject({
        blocks: { empty: [{ path: "revenue", type: "ChartCard" }] },
      });
    });
  });
});
