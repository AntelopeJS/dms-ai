import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  NAVIGATE_RESULT_COMPLETED_SUFFIX,
  NAVIGATE_RESULT_LANDED_PREFIX,
  NAVIGATE_RESULT_PREFIX,
  NAVIGATE_RESULT_TIMEOUT_SUFFIX,
  NAVIGATE_SUGGESTION_LIMIT,
  NAVIGATE_TOOL_DESCRIPTION,
  NAVIGATE_TOOL_NAME,
  NAVIGATE_UNKNOWN_ROUTE_HINT,
  NAVIGATE_UNKNOWN_ROUTE_PREFIX,
  NAVIGATE_UNKNOWN_ROUTE_SUFFIX,
} from "../../constants/mcp.js";
import { NAVIGATE_TIMEOUT_MS } from "../../constants/timing.js";
import type { RegistryClient } from "../../pages/registry-client.js";
import { isKnownRoute } from "../../pages/route-match.js";
import { type AnyServerEventType, EVENT_TYPES } from "../../protocol/events.js";
import type { NavigationCompleter } from "../../server/navigation-completer.js";
import type { CurrentPage } from "../../state/host-state.js";

export interface NavigateToPageDeps {
  sendToHost: (event: AnyServerEventType) => void;
  navigationCompleter: NavigationCompleter;
  registry: RegistryClient;
  getCurrentPage: () => CurrentPage;
}

const INPUT_SCHEMA = { path: z.string() } as const;

function buildNavigationEvent(targetPath: string): AnyServerEventType {
  return {
    type: EVENT_TYPES.HOST_COMMAND_NAVIGATE,
    path: targetPath,
  };
}

// Best-effort list of registered routes; never blocks navigation on its own
// failure (the validation below only fires when this is non-empty).
async function safeKnownRoutes(registry: RegistryClient): Promise<string[]> {
  try {
    const entries = await registry.getRegistry();
    return entries.map((e) => e.path);
  } catch {
    return [];
  }
}

function jsonContent(payload: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function buildUnknownRouteText(
  targetPath: string,
  suggestions: string[],
): string {
  return `${NAVIGATE_UNKNOWN_ROUTE_PREFIX}${targetPath}${NAVIGATE_UNKNOWN_ROUTE_SUFFIX}${suggestions.join(", ")}${NAVIGATE_UNKNOWN_ROUTE_HINT}`;
}

function buildUnknownRouteContent(
  targetPath: string,
  knownRoutes: string[],
): { content: Array<{ type: "text"; text: string }> } {
  const suggestions = knownRoutes.slice(0, NAVIGATE_SUGGESTION_LIMIT);
  return jsonContent({
    ok: false,
    error: { code: "unknown_route", path: targetPath, suggestions },
    message: buildUnknownRouteText(targetPath, suggestions),
  });
}

function buildResultText(
  targetPath: string,
  isCompleted: boolean,
  landedOn: CurrentPage,
): string {
  const suffix = isCompleted
    ? NAVIGATE_RESULT_COMPLETED_SUFFIX
    : NAVIGATE_RESULT_TIMEOUT_SUFFIX;
  return `${NAVIGATE_RESULT_PREFIX}${targetPath}${suffix}${NAVIGATE_RESULT_LANDED_PREFIX}${landedOn.path}`;
}

function buildContent(
  targetPath: string,
  isCompleted: boolean,
  landedOn: CurrentPage,
): { content: Array<{ type: "text"; text: string }> } {
  return jsonContent({
    ok: true,
    data: {
      path: targetPath,
      navigation: isCompleted ? "completed" : "timeout",
      currentPage: landedOn,
    },
    message: buildResultText(targetPath, isCompleted, landedOn),
  });
}

export function buildNavigateToPageTool(deps: NavigateToPageDeps) {
  return tool(
    NAVIGATE_TOOL_NAME,
    NAVIGATE_TOOL_DESCRIPTION,
    INPUT_SCHEMA,
    async ({ path: targetPath }: { path: string }) => {
      // Guard against guessed URLs: if we have a non-empty registry and the
      // path isn't a known route, return suggestions instead of navigating into
      // a 404. Fail open when the registry is empty/unreachable.
      const knownRoutes = await safeKnownRoutes(deps.registry);
      if (knownRoutes.length > 0 && !isKnownRoute(targetPath, knownRoutes)) {
        return buildUnknownRouteContent(targetPath, knownRoutes);
      }
      const waitPromise = deps.navigationCompleter.waitFor(
        targetPath,
        NAVIGATE_TIMEOUT_MS,
      );
      deps.sendToHost(buildNavigationEvent(targetPath));
      const isCompleted = await waitPromise;
      return buildContent(targetPath, isCompleted, deps.getCurrentPage());
    },
  );
}
