import type { WebSocket } from "ws";
import { WS_LOG_PREFIX } from "../constants/ws.js";
import type { AnyServerEventType } from "../protocol/events.js";

export interface HostSocketRegistry {
  set: (socket: WebSocket) => void;
  clear: (socket: WebSocket) => void;
  send: (event: AnyServerEventType) => void;
  has: () => boolean;
}

interface RegistryState {
  socket: WebSocket | null;
}

function trySend(socket: WebSocket, event: AnyServerEventType): void {
  try {
    socket.send(JSON.stringify(event));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${WS_LOG_PREFIX} sendToHost failed: ${message}`);
  }
}

function buildSet(state: RegistryState) {
  return (socket: WebSocket): void => {
    state.socket = socket;
  };
}

function buildClear(state: RegistryState) {
  return (socket: WebSocket): void => {
    if (state.socket !== socket) return;
    state.socket = null;
  };
}

function buildSend(state: RegistryState) {
  return (event: AnyServerEventType): void => {
    const socket = state.socket;
    if (socket === null) {
      console.warn(`${WS_LOG_PREFIX} sendToHost: no host connected`);
      return;
    }
    trySend(socket, event);
  };
}

export function createHostSocketRegistry(): HostSocketRegistry {
  const state: RegistryState = { socket: null };
  return {
    set: buildSet(state),
    clear: buildClear(state),
    send: buildSend(state),
    has: () => state.socket !== null,
  };
}
