import { describe, expect, it, vi } from "vitest";
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

interface ToolHandlerLike {
  name: string;
  handler: (
    args: { path: string },
    extra: unknown,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
}

interface SpyDeps {
  calls: AnyServerEventType[];
  sendToHost: (event: AnyServerEventType) => void;
  navigationCompleter: NavigationCompleter;
  registry: RegistryClient;
  getCurrentPage: () => { path: string };
}

const STUB_CURRENT_PAGE = { path: "/stub-current" };

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

// Empty registry → validation fails open (navigation always proceeds).
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

function buildTool(deps: SpyDeps): ToolHandlerLike {
  return buildNavigateToPageTool({
    sendToHost: deps.sendToHost,
    navigationCompleter: deps.navigationCompleter,
    registry: deps.registry,
    getCurrentPage: deps.getCurrentPage,
  }) as unknown as ToolHandlerLike;
}

// Let the handler progress past its async registry-validation step so the
// navigation waiter is registered before we complete it.
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
    const promise = toolDef.handler({ path: "/dashboard/settings" }, undefined);
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
    const promise = toolDef.handler({ path: "/about" }, undefined);
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
      const promise = toolDef.handler({ path: "/never" }, undefined);
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
    const result = await toolDef.handler({ path: "/pages?" }, undefined);
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
    const promise = toolDef.handler({ path: "/form/form-simple/" }, undefined);
    await tick();
    deps.navigationCompleter.complete("/form/form-simple/");
    await promise;
    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0]).toEqual({
      type: EVENT_TYPES.HOST_COMMAND_NAVIGATE,
      path: "/form/form-simple/",
    });
  });
});
