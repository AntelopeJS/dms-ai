import type { WebSocket } from "ws";
import { WS_LOG_PREFIX } from "../constants/ws.js";
import type { AnyServerEventType } from "../protocol/events.js";

/** The part of a socket the registries use: they only ever send to it. */
export type SocketSender = Pick<WebSocket, "send">;

export interface HostSocketRegistry {
  set: (socket: SocketSender) => void;
  clear: (socket: SocketSender) => void;
  send: (event: AnyServerEventType, preferred?: SocketSender) => void;
  has: () => boolean;
}

interface RegistryState {
  sockets: SocketSender[];
}

function trySend(socket: SocketSender, event: AnyServerEventType): void {
  try {
    socket.send(JSON.stringify(event));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${WS_LOG_PREFIX} sendToHost failed: ${message}`);
  }
}

function removeSocket(state: RegistryState, socket: SocketSender): void {
  state.sockets = state.sockets.filter((current) => current !== socket);
}

function buildSet(state: RegistryState) {
  return (socket: SocketSender): void => {
    removeSocket(state, socket);
    state.sockets.push(socket);
  };
}

function pickSocket(
  state: RegistryState,
  preferred: SocketSender | undefined,
): SocketSender | undefined {
  if (preferred !== undefined && state.sockets.includes(preferred)) {
    return preferred;
  }
  return state.sockets.at(-1);
}

function buildSend(state: RegistryState) {
  return (event: AnyServerEventType, preferred?: SocketSender): void => {
    const socket = pickSocket(state, preferred);
    if (socket === undefined) {
      console.warn(`${WS_LOG_PREFIX} sendToHost: no host connected`);
      return;
    }
    trySend(socket, event);
  };
}

/**
 * Tracks every socket that said hello as a host. A command goes to the
 * preferred socket when it is still a host, else to the latest host.
 */
export function createHostSocketRegistry(): HostSocketRegistry {
  const state: RegistryState = { sockets: [] };
  return {
    set: buildSet(state),
    clear: (socket) => removeSocket(state, socket),
    send: buildSend(state),
    has: () => state.sockets.length > 0,
  };
}
