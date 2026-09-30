import type { ChannelBridge } from "./bridge";

const bridges = new Map<string, ChannelBridge>();
const pendingSockets = new Map<string, number>();

function openSocketsOf(userId: string): number {
  let count = pendingSockets.get(userId) ?? 0;
  for (const bridge of bridges.values()) {
    if (bridge.userId === userId) count += 1;
  }
  return count;
}

/** Holds `count` sockets for a user while they connect; false past `limit`. */
export function reserveSockets(
  userId: string,
  count: number,
  limit: number,
): boolean {
  if (openSocketsOf(userId) + count > limit) return false;
  pendingSockets.set(userId, (pendingSockets.get(userId) ?? 0) + count);
  return true;
}

/** Returns sockets held by `reserveSockets`, once connected or failed. */
export function releaseSockets(userId: string, count: number): void {
  const left = (pendingSockets.get(userId) ?? 0) - count;
  if (left > 0) pendingSockets.set(userId, left);
  else pendingSockets.delete(userId);
}

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
