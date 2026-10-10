import type { AllowedBy } from "../constants/audit.js";

// Codex fans one patch out into `<itemId>:<index>` calls; its approval names
// the item alone.
const CALL_INDEX_SEPARATOR = ":";

/** How one call was allowed, as decided before it ran. */
export interface CallDecision {
  allowedBy: AllowedBy;
  // The user was asked about it.
  isPrompted: boolean;
}

export interface CallAudit {
  record(conversationId: string, callId: string, decision: CallDecision): void;
  lookup(conversationId: string, callId: string): CallDecision | undefined;
  forget(conversationId: string): void;
}

function itemIdOf(callId: string): string {
  const index = callId.lastIndexOf(CALL_INDEX_SEPARATOR);
  return index < 0 ? callId : callId.slice(0, index);
}

export function createCallAudit(): CallAudit {
  const byConversation = new Map<string, Map<string, CallDecision>>();
  return {
    record(conversationId, callId, decision) {
      const calls = byConversation.get(conversationId) ?? new Map();
      calls.set(callId, decision);
      byConversation.set(conversationId, calls);
    },
    lookup(conversationId, callId) {
      const calls = byConversation.get(conversationId);
      return calls?.get(callId) ?? calls?.get(itemIdOf(callId));
    },
    forget(conversationId) {
      byConversation.delete(conversationId);
    },
  };
}
