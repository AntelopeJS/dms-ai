import { z } from "zod";
import type {
  AnyClientMessageType,
  ClientHelloMsgType,
} from "../protocol/messages.js";
import { MESSAGE_TYPES, ROLE } from "../protocol/messages.js";
import type {
  AssistantMode,
  ConversationOwner,
} from "../state/assistant-mode.js";

/** Who drives a connection, as the backend bridge announced it. */
export interface Actor {
  userId: string;
  name: string;
  tenantId: string;
  isOwner: boolean;
  /** The assistant modes the backend lets this user run. */
  modes: AssistantMode[];
  /** What Analyst reads data as this user with. */
  grant: string;
}

/** What decides an actor's reach: the actor, and whether this is development. */
export interface AccessScope {
  actor: Actor | null;
  isDevelopment: boolean;
}

/** What access needs to know of a conversation. */
export interface ConversationAccessView {
  owner?: ConversationOwner;
  assistant?: AssistantMode;
}

/**
 * Builder runs only in development, and only for an actor the backend let run
 * it. A socket no backend bridged (no actor) is the development tooling's.
 */
export function mayRunBuilder(scope: AccessScope): boolean {
  if (!scope.isDevelopment) return false;
  return scope.actor === null || scope.actor.modes.includes("builder");
}

function isOwnedBy(owner: ConversationOwner | undefined, actor: Actor | null) {
  return (
    owner !== undefined &&
    actor !== null &&
    owner.userId === actor.userId &&
    owner.tenantId === actor.tenantId
  );
}

/**
 * Everyone sees the conversations they started, in the tenant they started
 * them in. Builder users also share every conversation but another user's
 * Analyst ones, as the project's development history.
 */
export function maySeeConversation(
  scope: AccessScope,
  conversation: ConversationAccessView | null,
): boolean {
  if (conversation === null) return true;
  if (isOwnedBy(conversation.owner, scope.actor)) return true;
  if (!mayRunBuilder(scope)) return false;
  return (
    conversation.owner === undefined || conversation.assistant !== "analyst"
  );
}

/**
 * Only the user who started a conversation switches it between Builder and
 * Analyst; one nobody owns yet, or a legacy one, follows the visibility rule.
 */
export function mayChangeAssistant(
  scope: AccessScope,
  conversation: ConversationAccessView | null,
): boolean {
  if (conversation?.owner === undefined) return true;
  return isOwnedBy(conversation.owner, scope.actor);
}

/** What an actor who may not run Builder may send: chatting, and nothing else. */
const ANALYST_MESSAGE_TYPES: ReadonlySet<AnyClientMessageType["type"]> =
  new Set([
    MESSAGE_TYPES.HELLO,
    MESSAGE_TYPES.ECHO,
    MESSAGE_TYPES.ACTOR,
    MESSAGE_TYPES.USER_MESSAGE,
    MESSAGE_TYPES.RETRY_TURN,
    MESSAGE_TYPES.QUESTION_RESPONSE,
    MESSAGE_TYPES.INTERRUPT_TURN,
    MESSAGE_TYPES.SET_CONVERSATION_MODE,
    MESSAGE_TYPES.LIST_CONVERSATIONS,
    MESSAGE_TYPES.DELETE_CONVERSATION,
    MESSAGE_TYPES.QUEUE_ENQUEUE,
    MESSAGE_TYPES.QUEUE_CANCEL,
    MESSAGE_TYPES.QUEUE_UPDATE,
    MESSAGE_TYPES.QUEUE_MOVE,
    MESSAGE_TYPES.QUEUE_CLEAR,
  ]);

function isHostHello(msg: AnyClientMessageType): msg is ClientHelloMsgType {
  return msg.type === MESSAGE_TYPES.HELLO && msg.role === ROLE.HOST;
}

/**
 * Whether the actor may send this kind of message at all. The actor frame
 * itself always passes: only the backend can send one, the bridge dropping any
 * a browser sends. Settings, change
 * sets, approvals and the host role (the browser the agent drives) are
 * Builder's; whether the conversation it names is theirs is checked apart.
 */
export function mayHandle(
  scope: AccessScope,
  msg: AnyClientMessageType,
): boolean {
  if (msg.type === MESSAGE_TYPES.ACTOR) return true;
  if (mayRunBuilder(scope)) return true;
  if (scope.actor === null) return false;
  if (isHostHello(msg)) return false;
  if (!ANALYST_MESSAGE_TYPES.has(msg.type)) return false;
  if (msg.type === MESSAGE_TYPES.SET_CONVERSATION_MODE) {
    return msg.assistant === undefined || msg.assistant === "analyst";
  }
  return true;
}

const NamesConversationSchema = z.object({ conversationId: z.string() });

/** The conversation id a message acts on, when it names one. */
export function conversationOf(msg: AnyClientMessageType): string | undefined {
  const named = NamesConversationSchema.safeParse(msg);
  return named.success ? named.data.conversationId : undefined;
}
