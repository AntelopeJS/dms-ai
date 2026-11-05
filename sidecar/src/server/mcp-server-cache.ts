import { createAiMcpServer } from "../mcp/sdk-binding.js";
import type { AiMcpServer, AiMcpServerDeps } from "../mcp/types.js";

/**
 * One MCP server per conversation, reused across its turns. Forgetting a
 * conversation drops its server, and with it whatever its tools held, such as
 * Analyst's datasets.
 */
export interface McpServerCache {
  get(conversationId: string): AiMcpServer;
  forget(conversationId: string): void;
}

export function createMcpServerCache(
  createMcpDeps: (conversationId: string) => AiMcpServerDeps,
  createServer: (deps: AiMcpServerDeps) => AiMcpServer = createAiMcpServer,
): McpServerCache {
  const byConversation = new Map<string, AiMcpServer>();
  return {
    get(conversationId) {
      const existing = byConversation.get(conversationId);
      if (existing !== undefined) return existing;
      const server = createServer(createMcpDeps(conversationId));
      byConversation.set(conversationId, server);
      return server;
    },
    forget(conversationId) {
      byConversation.delete(conversationId);
    },
  };
}
