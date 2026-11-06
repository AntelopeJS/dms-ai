import { MCP_TOOL_NAME_PREFIX } from "../constants/mcp.js";
import { isMcpToolName } from "../constants/tool-titles.js";
import type { StoredConversation, StoredMessage } from "./types.js";

const WORD_BOUNDARY = /([a-z0-9])([A-Z])/g;

/**
 * The current name of a tool a transcript recorded before dms-ai's MCP tools
 * were renamed to snake_case: `mcp__dms-ai__BuilderAddBlock` becomes
 * `mcp__dms-ai__builder_add_block`. Any other name is returned as is.
 */
export function currentToolName(toolName: string): string {
  if (!toolName.startsWith(MCP_TOOL_NAME_PREFIX)) return toolName;
  const bare = toolName.slice(MCP_TOOL_NAME_PREFIX.length);
  const snake = bare.replace(WORD_BOUNDARY, "$1_$2").toLowerCase();
  return snake !== bare && isMcpToolName(snake)
    ? `${MCP_TOOL_NAME_PREFIX}${snake}`
    : toolName;
}

function migrateMessage(message: StoredMessage): StoredMessage {
  const toolName =
    message.toolName === undefined
      ? undefined
      : currentToolName(message.toolName);
  const notice =
    message.notice?.kind === "permission_expired"
      ? {
          ...message.notice,
          toolName: currentToolName(message.notice.toolName),
        }
      : message.notice;
  return toolName === message.toolName && notice === message.notice
    ? message
    : { ...message, toolName, notice };
}

/** A stored conversation with every legacy dms-ai tool name made current. */
export function migrateConversation(
  conversation: StoredConversation,
): StoredConversation {
  return {
    ...conversation,
    messages: conversation.messages.map(migrateMessage),
  };
}
