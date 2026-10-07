import type { WebSocket } from "ws";
import { WS_LOG_PREFIX } from "../constants/ws.js";
import type { AnyServerEventType } from "../protocol/events.js";

export interface ChatSocketRegistry {
  set: (conversationId: string, socket: WebSocket) => void;
  /** A chat socket attached to no conversation yet (still reached by broadcast). */
  addChat: (socket: WebSocket) => void;
  clear: (socket: WebSocket) => void;
  /** Every socket showing the conversation: one per open tab. */
  send: (conversationId: string, event: AnyServerEventType) => void;
  /** Every chat socket, attached to a conversation or not. */
  broadcast: (event: AnyServerEventType) => void;
  has: (conversationId: string) => boolean;
  /** The socket that most recently opened the conversation. */
  socketOf: (conversationId: string) => WebSocket | undefined;
}

interface RegistryState {
  byConversation: Map<string, Set<WebSocket>>;
  chats: Set<WebSocket>;
}

function trySend(socket: WebSocket, event: AnyServerEventType): void {
  try {
    socket.send(JSON.stringify(event));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${WS_LOG_PREFIX} sendToChat failed: ${message}`);
  }
}

function detach(state: RegistryState, socket: WebSocket): void {
  for (const [id, sockets] of state.byConversation) {
    sockets.delete(socket);
    if (sockets.size === 0) state.byConversation.delete(id);
  }
}

// A socket maps to exactly one active conversation: drop any prior mapping
// for this socket so events from the conversation the user switched away from
// stop streaming here (they keep buffering in liveTurns and replay on
// switch-back). Other tabs on the same conversation keep receiving.
function attach(
  state: RegistryState,
  conversationId: string,
  socket: WebSocket,
): void {
  detach(state, socket);
  const sockets = state.byConversation.get(conversationId) ?? new Set();
  sockets.delete(socket);
  sockets.add(socket);
  state.byConversation.set(conversationId, sockets);
  state.chats.add(socket);
}

export function createChatSocketRegistry(): ChatSocketRegistry {
  const state: RegistryState = { byConversation: new Map(), chats: new Set() };
  return {
    set: (conversationId, socket) => attach(state, conversationId, socket),
    addChat: (socket) => {
      state.chats.add(socket);
    },
    clear: (socket) => {
      detach(state, socket);
      state.chats.delete(socket);
    },
    send: (conversationId, event) => {
      for (const socket of state.byConversation.get(conversationId) ?? []) {
        trySend(socket, event);
      }
    },
    broadcast: (event) => {
      for (const socket of state.chats) trySend(socket, event);
    },
    has: (conversationId) => state.byConversation.has(conversationId),
    socketOf: (conversationId) =>
      [...(state.byConversation.get(conversationId) ?? [])].at(-1),
  };
}
