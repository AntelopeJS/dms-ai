import type { AnyMcpToolDefinition } from "./define-tool.js";
import { buildAskUserTool } from "./tools/ask-user.js";
import { buildBuilderTools } from "./tools/builder.js";
import { buildFindPagesUsingTool } from "./tools/find-pages-using.js";
import { buildGetCurrentPageTool } from "./tools/get-current-page.js";
import { buildListPagesTool } from "./tools/list-pages.js";
import { buildNavigateToPageTool } from "./tools/navigate-to-page.js";
import { buildQueryLogsTool } from "./tools/query-logs.js";
import { buildTypecheckTool } from "./tools/typecheck.js";
import type { AiMcpServerDeps } from "./types.js";

export function buildToolDefinitions(
  deps: AiMcpServerDeps,
): AnyMcpToolDefinition[] {
  const builderTools = deps.builderEnabled
    ? buildBuilderTools({ builderClient: deps.builderClient })
    : [];
  return [
    ...builderTools,
    buildGetCurrentPageTool(deps.getCurrentPage),
    buildFindPagesUsingTool({
      registry: deps.registry,
      scanner: deps.scanner,
      hostProjectRoot: deps.hostProjectRoot,
      getCurrentPage: deps.getCurrentPage,
    }),
    buildListPagesTool({ registry: deps.registry }),
    buildNavigateToPageTool({
      sendToHost: deps.sendToHost,
      navigationCompleter: deps.navigationCompleter,
      registry: deps.registry,
      getCurrentPage: deps.getCurrentPage,
    }),
    buildAskUserTool({
      conversationId: deps.conversationId,
      requestQuestion: deps.requestQuestion,
    }),
    buildTypecheckTool({
      hostProjectRoot: deps.hostProjectRoot,
      moduleRoots: deps.moduleRoots,
      getLastEditedFile: deps.getLastEditedFile,
    }),
    buildQueryLogsTool({ logsClient: deps.logsClient }),
  ];
}
