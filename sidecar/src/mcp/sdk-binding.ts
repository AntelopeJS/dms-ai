import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from "../constants/mcp.js";
import type { AnyMcpToolDefinition } from "./define-tool.js";
import { buildToolDefinitions } from "./tool-definitions.js";
import type { AiMcpServer, AiMcpServerDeps } from "./types.js";

function toSdkTool(definition: AnyMcpToolDefinition) {
  return tool(
    definition.name,
    definition.description,
    definition.schema,
    definition.handler,
  );
}

/**
 * The in-process binding: the neutral tool definitions handed to the Claude
 * SDK's own MCP server. Mirror of http-binding.ts, which serves the same
 * definitions to Codex over loopback HTTP because its agent runs out of process.
 */
export function createAiMcpServer(deps: AiMcpServerDeps): AiMcpServer {
  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    tools: buildToolDefinitions(deps).map(toSdkTool),
  });
}
