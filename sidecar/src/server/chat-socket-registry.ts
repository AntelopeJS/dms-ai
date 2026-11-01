import { WS_LOG_PREFIX } from "../constants/ws.js";
import type { AnyServerEventType } from "../protocol/events.js";
import type { SocketSender } from "./host-socket-registry.js";

export interface ChatSocketRegistry {
  set: (conversationId: string, socket: SocketSender) => void;
  /**
   * The socket also receives the conversation's events, whatever it shows:
   * opening another conversation does not drop it, only closing the socket.
   */
  follow: (conversationId: string, socket: SocketSender) => void;
  /** A chat socket attached to no conversation yet (still reached by broadcast). */
  addChat: (socket: SocketSender) => void;
  clear: (socket: SocketSender) => void;
  /** Every socket showing the conversation: one per open tab. */
  send: (conversationId: string, event: AnyServerEventType) => void;
  /** Every chat socket, attached to a conversation or not. */
  broadcast: (event: AnyServerEventType) => void;
  has: (conversationId: string) => boolean;
  /** The socket that most recently opened the conversation, else one following it. */
  socketOf: (conversationId: string) => SocketSender | undefined;
}

interface RegistryState {
  byConversation: Map<string, Set<SocketSender>>;
  followers: Map<string, Set<SocketSender>>;
  chats: Set<SocketSender>;
}

function trySend(socket: SocketSender, event: AnyServerEventType): void {
  try {
    socket.send(JSON.stringify(event));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${WS_LOG_PREFIX} sendToChat failed: ${message}`);
  }
}

function removeFrom(
  map: Map<string, Set<SocketSender>>,
  socket: SocketSender,
): void {
  for (const [id, sockets] of map) {
    sockets.delete(socket);
    if (sockets.size === 0) map.delete(id);
  }
}

function addTo(
  map: Map<string, Set<SocketSender>>,
  conversationId: string,
  socket: SocketSender,
): void {
  const sockets = map.get(conversationId) ?? new Set();
  sockets.delete(socket);
  sockets.add(socket);
  map.set(conversationId, sockets);
}

/** Every socket the conversation's events go to, each once. */
function recipients(
  state: RegistryState,
  conversationId: string,
): Set<SocketSender> {
  return new Set([
    ...(state.byConversation.get(conversationId) ?? []),
    ...(state.followers.get(conversationId) ?? []),
  ]);
}

/**
 * A socket maps to exactly one active conversation: drop any prior mapping
 * for this socket so events from the conversation the user switched away from
 * stop streaming here (they keep buffering in liveTurns and replay on
 * switch-back). Other tabs on the same conversation keep receiving.
 */
function attach(
  state: RegistryState,
  conversationId: string,
  socket: SocketSender,
): void {
  removeFrom(state.byConversation, socket);
  addTo(state.byConversation, conversationId, socket);
  state.chats.add(socket);
}

export function createChatSocketRegistry(): ChatSocketRegistry {
  const state: RegistryState = {
    byConversation: new Map(),
    followers: new Map(),
    chats: new Set(),
  };
  return {
    set: (conversationId, socket) => attach(state, conversationId, socket),
    follow: (conversationId, socket) => {
      addTo(state.followers, conversationId, socket);
      state.chats.add(socket);
    },
    addChat: (socket) => {
      state.chats.add(socket);
    },
    clear: (socket) => {
      removeFrom(state.byConversation, socket);
      removeFrom(state.followers, socket);
      state.chats.delete(socket);
    },
    send: (conversationId, event) => {
      for (const socket of recipients(state, conversationId)) {
        trySend(socket, event);
      }
    },
    broadcast: (event) => {
      for (const socket of state.chats) trySend(socket, event);
    },
    has: (conversationId) => state.byConversation.has(conversationId),
    socketOf: (conversationId) =>
      [...(state.byConversation.get(conversationId) ?? [])].at(-1) ??
      [...(state.followers.get(conversationId) ?? [])].at(-1),
  };
}
