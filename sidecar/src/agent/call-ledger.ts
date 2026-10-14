import { bareToolName } from "./tool-kinds.js";

// Announced calls kept per conversation; older ones are long settled.
const MAX_ANNOUNCED_CALLS = 100;

interface AnnouncedCall {
  callId: string;
  toolName: string;
  argsKey: string;
}

/**
 * Pairs an MCP tool handler with the provider's id for the call. No MCP
 * transport hands the handler that id, so the provider announces each call as
 * it sees it (Claude's `canUseTool`, Codex's `item/started`) and the handler
 * claims it by tool name and arguments.
 */
export interface CallLedger {
  announce(
    conversationId: string,
    callId: string,
    toolName: string,
    args: unknown,
  ): void;
  claim(
    conversationId: string,
    toolName: string,
    args: unknown,
  ): string | undefined;
  forget(conversationId: string): void;
}

function argsKey(args: unknown): string {
  try {
    return JSON.stringify(args ?? null);
  } catch {
    return "";
  }
}

export function createCallLedger(): CallLedger {
  const byConversation = new Map<string, AnnouncedCall[]>();
  return {
    announce(conversationId, callId, toolName, args) {
      const calls = byConversation.get(conversationId) ?? [];
      if (calls.some((call) => call.callId === callId)) return;
      calls.push({
        callId,
        toolName: bareToolName(toolName),
        argsKey: argsKey(args),
      });
      byConversation.set(conversationId, calls.slice(-MAX_ANNOUNCED_CALLS));
    },
    claim(conversationId, toolName, args) {
      const calls = byConversation.get(conversationId) ?? [];
      const name = bareToolName(toolName);
      const key = argsKey(args);
      const exact = calls.findIndex(
        (c) => c.toolName === name && c.argsKey === key,
      );
      const index =
        exact >= 0 ? exact : calls.findIndex((c) => c.toolName === name);
      if (index < 0) return undefined;
      const [claimed] = calls.splice(index, 1);
      return claimed?.callId;
    },
    forget(conversationId) {
      byConversation.delete(conversationId);
    },
  };
}
