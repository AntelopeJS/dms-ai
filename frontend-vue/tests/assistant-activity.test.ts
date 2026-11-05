import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import {
	type AssistantStatusPayload,
	createAssistantActivity,
} from "../app/runtime/assistant-activity";
import type { ChannelStatus } from "../app/runtime/channel-client";
import type { ChatTransport } from "../app/runtime/chat-transport";

type Listener = (msg: object) => void;
type StatusListener = (status: ChannelStatus) => void;

function fakeChat(initial: ChannelStatus = "connected") {
	const listeners = new Set<Listener>();
	const statusListeners = new Set<StatusListener>();
	let status = initial;
	const chat = {
		onMessage: (listener: Listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		onStatus: (listener: StatusListener) => {
			statusListeners.add(listener);
			return () => statusListeners.delete(listener);
		},
		getStatus: () => status,
	} as unknown as ChatTransport;
	return {
		chat,
		emit: (msg: object) => listeners.forEach((l) => l(msg)),
		announce: (next: ChannelStatus) => {
			status = next;
			statusListeners.forEach((l) => l(next));
		},
	};
}

function activityOver(chat: ChatTransport) {
	const data = ref<AssistantStatusPayload | null>(null);
	const activity = createAssistantActivity({
		readStatus: () => ({ data, refresh: async () => undefined }),
		chat,
		shouldPoll: () => true,
	});
	return { data, activity };
}

describe("assistant activity", () => {
	it("polls the status through the read's interval while it is useful, and stops on teardown", async () => {
		const data = ref<AssistantStatusPayload | null>(null);
		let interval: () => number = () => -1;
		const isPanelOpen = ref(false);
		const { chat } = fakeChat();
		const activity = createAssistantActivity({
			readStatus: (given) => {
				interval = given;
				return { data, refresh: async () => undefined };
			},
			chat,
			shouldPoll: () => !isPanelOpen.value,
		});
		expect(interval()).toBe(15_000);
		isPanelOpen.value = true;
		expect(interval()).toBe(0);
		isPanelOpen.value = false;
		activity.stop();
		expect(interval()).toBe(0);
	});

	it("takes its counts from each status answer and from the stream's lists, and from the status again once the stream drops", async () => {
		const { chat, emit, announce } = fakeChat();
		const { data, activity } = activityOver(chat);
		data.value = { pendingApprovals: 2, workingConversations: 0 };
		await nextTick();
		expect(activity.pendingApprovals.value).toBe(2);
		expect(activity.isBusy.value).toBe(true);
		emit({ type: "conversation_list", conversations: [{ isRunning: true }] });
		expect(activity.pendingApprovals.value).toBe(0);
		expect(activity.workingConversations.value).toBe(1);
		announce("reconnecting");
		data.value = {
			pendingApprovals: 0,
			workingConversations: 0,
			lastError: "boom",
		};
		await nextTick();
		expect(activity.workingConversations.value).toBe(0);
		expect(activity.lastError.value).toBe("boom");
		activity.stop();
	});

	it("keeps the stream open while a question waits, from the status and from a list", async () => {
		const data = ref<AssistantStatusPayload | null>(null);
		const { chat, emit } = fakeChat();
		const activity = createAssistantActivity({
			readStatus: () => ({ data, refresh: async () => undefined }),
			chat,
			shouldPoll: () => true,
		});
		data.value = { pendingQuestions: 1 };
		await nextTick();
		expect(activity.pendingQuestions.value).toBe(1);
		expect(activity.pendingApprovals.value).toBe(0);
		expect(activity.isBusy.value).toBe(true);
		emit({ type: "conversation_list", conversations: [{}] });
		expect(activity.pendingQuestions.value).toBe(0);
		expect(activity.isBusy.value).toBe(false);
		emit({
			type: "conversation_list",
			conversations: [{ pendingQuestions: 1 }, { pendingQuestions: 2 }],
		});
		expect(activity.pendingQuestions.value).toBe(3);
		expect(activity.pendingApprovals.value).toBe(0);
		expect(activity.isBusy.value).toBe(true);
		activity.stop();
	});

	it("keeps a finished turn when a status answer from before the turn ended lands after the list (fails if the poll rewinds the list's counts)", async () => {
		const { chat, emit } = fakeChat();
		const { data, activity } = activityOver(chat);
		emit({ type: "conversation_list", conversations: [{ isRunning: true }] });
		emit({ type: "conversation_list", conversations: [{ isRunning: false }] });
		data.value = { workingConversations: 1, lastError: "late" };
		await nextTick();
		expect(activity.workingConversations.value).toBe(0);
		expect(activity.isBusy.value).toBe(false);
		expect(activity.lastError.value).toBe("late");
		activity.stop();
	});

	it("keeps a running turn when a stale status answer says all is idle (fails if the poll overwrites the list's counts)", async () => {
		const { chat, emit } = fakeChat();
		const { data, activity } = activityOver(chat);
		emit({
			type: "conversation_list",
			conversations: [{ isRunning: true, pendingQuestions: 1 }],
		});
		data.value = { workingConversations: 0, pendingQuestions: 0 };
		await nextTick();
		expect(activity.workingConversations.value).toBe(1);
		expect(activity.pendingQuestions.value).toBe(1);
		activity.stop();
	});

	it("takes the counts from the status while a connected stream has sent no list (fails if a bare connection silences the poll)", async () => {
		const { chat, emit, announce } = fakeChat();
		const { data, activity } = activityOver(chat);
		data.value = { workingConversations: 1 };
		await nextTick();
		expect(activity.workingConversations.value).toBe(1);
		emit({ type: "conversation_list", conversations: [] });
		announce("reconnecting");
		announce("connected");
		data.value = { workingConversations: 2 };
		await nextTick();
		expect(activity.workingConversations.value).toBe(2);
		activity.stop();
	});
});
