import type { AnyServerEventType } from "../protocol/events.js";

export interface LiveTurnStore {
  begin: (conversationId: string) => void;
  append: (conversationId: string, event: AnyServerEventType) => void;
  end: (conversationId: string) => void;
  replay: (conversationId: string) => AnyServerEventType[] | null;
}

interface LiveTurnState {
  byConversation: Map<string, AnyServerEventType[]>;
}

export function createLiveTurnStore(): LiveTurnStore {
  const state: LiveTurnState = { byConversation: new Map() };
  return {
    begin: (conversationId) => {
      state.byConversation.set(conversationId, []);
    },
    append: (conversationId, event) => {
      state.byConversation.get(conversationId)?.push(event);
    },
    end: (conversationId) => {
      state.byConversation.delete(conversationId);
    },
    replay: (conversationId) =>
      state.byConversation.get(conversationId) ?? null,
  };
}
