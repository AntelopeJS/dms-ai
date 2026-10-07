import { computed, type ComputedRef, type Ref, ref } from "vue";
import type { ChatTransport } from "./chat-transport";
import { STATUS_POLL_MS } from "./constants";
import { isTypedMessage } from "./typed-message";

/** The backend's `/ai/status`, as far as the tab reads it. */
export interface AssistantStatusPayload {
	pendingApprovals?: number;
	workingConversations?: number;
	lastError?: string;
}

interface ConversationListItem {
	isRunning?: boolean;
	pendingApprovals?: number;
}

interface ConversationListFrame {
	type: "conversation_list";
	conversations?: ConversationListItem[];
}

const CONVERSATION_LIST_TYPE = "conversation_list";

export interface AssistantActivity {
	/** Requests waiting for an answer, across every chat. */
	pendingApprovals: Readonly<Ref<number>>;
	/** Chats running a turn now. */
	workingConversations: Readonly<Ref<number>>;
	/** A chat works or waits: the stream is worth keeping while the tab shows. */
	isBusy: ComputedRef<boolean>;
	lastError: Readonly<Ref<string | null>>;
	/** Re-reads the backend's status now. */
	refresh: () => Promise<void>;
	stop: () => void;
}

export interface AssistantActivityOptions {
	fetchStatus: () => Promise<AssistantStatusPayload>;
	chat: ChatTransport;
	/** Whether polling is useful now: the tab shows and the panel is closed. */
	shouldPoll: () => boolean;
}

function isListFrame(msg: object): msg is ConversationListFrame {
	return isTypedMessage(msg) && msg.type === CONVERSATION_LIST_TYPE;
}

function sum(
	items: ConversationListItem[],
	read: (item: ConversationListItem) => number,
): number {
	return items.reduce((total, item) => total + read(item), 0);
}

/**
 * What the tab knows of the assistant's work across chats, from the backend's
 * status (polled while the panel is closed) and from the conversation lists
 * the sidecar broadcasts while the stream is open.
 */
export function createAssistantActivity(
	options: AssistantActivityOptions,
): AssistantActivity {
	const pendingApprovals = ref(0);
	const workingConversations = ref(0);
	const lastError = ref<string | null>(null);

	const refresh = async (): Promise<void> => {
		try {
			const status = await options.fetchStatus();
			pendingApprovals.value = status.pendingApprovals ?? 0;
			workingConversations.value = status.workingConversations ?? 0;
			lastError.value = status.lastError ?? null;
		} catch {
			return;
		}
	};

	const stopListening = options.chat.onMessage((msg) => {
		if (!isListFrame(msg)) return;
		const items = msg.conversations ?? [];
		pendingApprovals.value = sum(items, (item) => item.pendingApprovals ?? 0);
		workingConversations.value = sum(items, (item) =>
			item.isRunning === true ? 1 : 0,
		);
	});

	const timer = setInterval(() => {
		if (options.shouldPoll()) void refresh();
	}, STATUS_POLL_MS);

	return {
		pendingApprovals,
		workingConversations,
		isBusy: computed(
			() => pendingApprovals.value > 0 || workingConversations.value > 0,
		),
		lastError,
		refresh,
		stop: () => {
			clearInterval(timer);
			stopListening();
		},
	};
}
