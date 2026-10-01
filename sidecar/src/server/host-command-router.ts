import type { AnyServerEventType } from "../protocol/events.js";
import type { HostSocketRegistry } from "./host-socket-registry.js";
import type { ChatSocketRegistry } from "./chat-socket-registry.js";

/** Sends a host command on behalf of one conversation. */
export type HostCommandSender = (event: AnyServerEventType) => void;

/**
 * Routes a conversation's host commands to the tab that carries it, since a
 * tab's host and chat share one socket; the latest host takes them otherwise.
 */
export function createHostCommandRouter(
  hosts: HostSocketRegistry,
  chats: ChatSocketRegistry,
): (conversationId: string) => HostCommandSender {
  return (conversationId) => (event) =>
    hosts.send(event, chats.socketOf(conversationId));
}
