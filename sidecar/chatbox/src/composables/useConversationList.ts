import { type Ref, ref } from "vue";
import { CLIENT_MESSAGE_TYPES, SERVER_EVENT_TYPES } from "../constants/ws";
import type { ConversationSummary } from "../types/conversation";

export interface UseConversationListOptions {
	send: (msg: object) => void;
	onMessage: (handler: (msg: unknown) => void) => () => void;
}

export interface UseConversationListResult {
	conversations: Ref<ConversationSummary[]>;
	refresh: () => void;
	remove: (id: string) => void;
}

interface ConversationListEvent {
	type: typeof SERVER_EVENT_TYPES.CONVERSATION_LIST;
	conversations: ConversationSummary[];
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function getEventType(msg: unknown): string | null {
	if (!isObject(msg)) return null;
	const t = msg.type;
	return typeof t === "string" ? t : null;
}

export function useConversationList(
	options: UseConversationListOptions,
): UseConversationListResult {
	const conversations = ref<ConversationSummary[]>([]);

	options.onMessage((msg: unknown): void => {
		if (getEventType(msg) !== SERVER_EVENT_TYPES.CONVERSATION_LIST) return;
		conversations.value = (msg as ConversationListEvent).conversations;
	});

	const refresh = (): void => {
		options.send({ type: CLIENT_MESSAGE_TYPES.LIST_CONVERSATIONS });
	};

	const remove = (id: string): void => {
		options.send({
			type: CLIENT_MESSAGE_TYPES.DELETE_CONVERSATION,
			conversationId: id,
		});
	};

	return { conversations, refresh, remove };
}
