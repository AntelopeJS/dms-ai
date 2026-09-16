import type { WebSocket } from "ws";
import { WS_LOG_PREFIX } from "../constants/ws.js";
import type { AnyServerEventType } from "../protocol/events.js";

export interface IframeSocketRegistry {
  set: (conversationId: string, socket: WebSocket) => void;
  clear: (socket: WebSocket) => void;
  send: (conversationId: string, event: AnyServerEventType) => void;
  broadcast: (event: AnyServerEventType) => void;
  has: (conversationId: string) => boolean;
}

interface RegistryState {
  byConversation: Map<string, WebSocket>;
}

function trySend(socket: WebSocket, event: AnyServerEventType): void {
  try {
    socket.send(JSON.stringify(event));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${WS_LOG_PREFIX} sendToIframe failed: ${message}`);
  }
}

function removeSocket(state: RegistryState, socket: WebSocket): void {
  for (const [id, current] of state.byConversation) {
    if (current === socket) state.byConversation.delete(id);
  }
}

function buildSet(state: RegistryState) {
  return (conversationId: string, socket: WebSocket): void => {
    // A socket maps to exactly one active conversation: drop any prior
    // mapping for this socket so events from the conversation the user
    // switched away from stop streaming here (they keep buffering in
    // liveTurns and replay on switch-back).
    removeSocket(state, socket);
    state.byConversation.set(conversationId, socket);
  };
}

function buildClear(state: RegistryState) {
  return (socket: WebSocket): void => {
    removeSocket(state, socket);
  };
}

function buildSend(state: RegistryState) {
  return (conversationId: string, event: AnyServerEventType): void => {
    const socket = state.byConversation.get(conversationId);
    if (socket === undefined) return;
    trySend(socket, event);
  };
}

function buildBroadcast(state: RegistryState) {
  return (event: AnyServerEventType): void => {
    const seen = new Set<WebSocket>();
    for (const socket of state.byConversation.values()) {
      if (seen.has(socket)) continue;
      seen.add(socket);
      trySend(socket, event);
    }
  };
}

export function createIframeSocketRegistry(): IframeSocketRegistry {
  const state: RegistryState = { byConversation: new Map() };
  return {
    set: buildSet(state),
    clear: buildClear(state),
    send: buildSend(state),
    broadcast: buildBroadcast(state),
    has: (conversationId) => state.byConversation.has(conversationId),
  };
}
