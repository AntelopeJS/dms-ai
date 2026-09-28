import type { ChannelBridge } from "./bridge";

/**
 * Open bridges of this module instance. Module state: a hot reload loads a
 * fresh copy that starts empty, so `closeAllBridges` must run from `destroy()`
 * or the previous generation's streams and sockets stay open for good.
 */
const bridges = new Map<string, ChannelBridge>();

export function trackBridge(bridge: ChannelBridge): void {
  bridges.set(bridge.id, bridge);
}

export function forgetBridge(bridge: ChannelBridge): void {
  bridges.delete(bridge.id);
}

/** A bridge only answers to the user who opened it; anyone else gets none. */
export function findOwnedBridge(
  connectionId: string,
  userId: string,
): ChannelBridge | undefined {
  const bridge = bridges.get(connectionId);
  return bridge?.userId === userId ? bridge : undefined;
}

/** Ends every stream and closes every sidecar socket this instance opened. */
export function closeAllBridges(): void {
  for (const bridge of bridges.values()) bridge.close();
  bridges.clear();
}
