import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from "../constants/mcp.js";
import { buildAskUserTool } from "./tools/ask-user.js";
import { buildBuilderTools } from "./tools/builder.js";
import { buildFindPagesUsingTool } from "./tools/find-pages-using.js";
import { buildGetCurrentPageTool } from "./tools/get-current-page.js";
import { buildListPagesTool } from "./tools/list-pages.js";
import { buildNavigateToPageTool } from "./tools/navigate-to-page.js";
import { buildQueryLogsTool } from "./tools/query-logs.js";
import { buildTypecheckTool } from "./tools/typecheck.js";
import type { AiMcpServer, AiMcpServerDeps } from "./types.js";

function buildTools(deps: AiMcpServerDeps) {
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

export function createAiMcpServer(deps: AiMcpServerDeps): AiMcpServer {
  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    tools: buildTools(deps),
  });
}
