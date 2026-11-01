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
import {
  type BlockHealth,
  describeBlocks,
  summarizeBlocks,
} from "../../pages/block-health.js";
import type { RegistryClient } from "../../pages/registry-client.js";
import { isKnownRoute } from "../../pages/route-match.js";
import { type AnyServerEventType, EVENT_TYPES } from "../../protocol/events.js";
import type {
  NavigationCompleter,
  NavigationLanding,
} from "../../server/navigation-completer.js";
import type { CurrentPage } from "../../state/host-state.js";
import { defineTool, type McpToolResult } from "../define-tool.js";

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

/**
 * Best-effort list of registered routes; never blocks navigation on its own
 * failure (the validation below only fires when this is non-empty).
 */
async function safeKnownRoutes(registry: RegistryClient): Promise<string[]> {
  try {
    const entries = await registry.getRegistry();
    return entries.map((e) => e.path);
  } catch {
    return [];
  }
}

function textContent(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
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
): McpToolResult {
  const suggestions = knownRoutes.slice(0, NAVIGATE_SUGGESTION_LIMIT);
  return textContent(
    JSON.stringify({
      ok: false,
      error: { code: "unknown_route", path: targetPath, suggestions },
      message: buildUnknownRouteText(targetPath, suggestions),
    }),
  );
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
  blocks: BlockHealth | null,
): McpToolResult {
  const message = buildResultText(targetPath, isCompleted, landedOn);
  return textContent(
    JSON.stringify({
      ok: true,
      data: {
        path: targetPath,
        navigation: isCompleted ? "completed" : "timeout",
        currentPage: landedOn,
        blocks: blocks ?? undefined,
      },
      message:
        blocks === null ? message : `${message}. ${describeBlocks(blocks)}`,
    }),
  );
}

/**
 * The health of the page's data blocks, when the host announced a report and
 * sent it in time; null otherwise (an older host, a page without data blocks).
 */
async function awaitBlockHealth(
  landing: NavigationLanding | null,
): Promise<BlockHealth | null> {
  const report = await landing?.blocks;
  return report ? summarizeBlocks(report) : null;
}

/**
 * Builds the tool that navigates the user's browser to a page. It guards
 * against guessed URLs: with a non-empty registry, a path that is not a known
 * route returns suggestions instead of navigating into a 404. It fails open
 * when the registry is empty or unreachable.
 */
export function buildNavigateToPageTool(deps: NavigateToPageDeps) {
  return defineTool(
    NAVIGATE_TOOL_NAME,
    NAVIGATE_TOOL_DESCRIPTION,
    INPUT_SCHEMA,
    async ({ path: targetPath }: { path: string }) => {
      const knownRoutes = await safeKnownRoutes(deps.registry);
      if (knownRoutes.length > 0 && !isKnownRoute(targetPath, knownRoutes)) {
        return buildUnknownRouteContent(targetPath, knownRoutes);
      }
      const waitPromise = deps.navigationCompleter.waitFor(
        targetPath,
        NAVIGATE_TIMEOUT_MS,
      );
      deps.sendToHost(buildNavigationEvent(targetPath));
      const landing = await waitPromise;
      const blocks = await awaitBlockHealth(landing);
      return buildContent(
        targetPath,
        landing !== null,
        deps.getCurrentPage(),
        blocks,
      );
    },
  );
}
