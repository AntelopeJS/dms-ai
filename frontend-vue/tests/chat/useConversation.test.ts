import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { useConversation } from "../../app/chat/composables/useConversation";
import {
	MESSAGE_ROLES,
	NOT_SENT_MESSAGE,
	RETRY_NEEDS_FILES_MESSAGE,
	STOP_NOT_DELIVERED_MESSAGE,
	TOOL_CUT_SHORT_RESULT,
	TOOL_STATUS,
} from "../../app/chat/constants/conversation";
import { CLIENT_MESSAGE_TYPES, SERVER_EVENT_TYPES } from "../../app/chat/constants/protocol";
import type { PendingAttachment } from "../../app/chat/utils/attachments";

const CONVERSATION_ID = "conv-chatbox-1";
const FILE_DATA = "PGh0bWw+PC9odG1sPg==";

interface Harness {
	conversation: ReturnType<typeof useConversation>;
	sent: Record<string, unknown>[];
	receive: (event: Record<string, unknown>) => void;
	setConnected: (isConnected: boolean) => void;
}

function harness(): Harness {
	const sent: Record<string, unknown>[] = [];
	let isConnected = true;
	let deliver: (msg: unknown) => void = () => {};
	const conversation = useConversation({
		activeId: ref(CONVERSATION_ID),
		send: (msg) => {
			if (!isConnected) return false;
			sent.push(msg as Record<string, unknown>);
			return true;
		},
		onMessage: (handler) => {
			deliver = handler;
			return () => {};
		},
	});
	return {
		conversation,
		sent,
		receive: (event) => deliver({ conversationId: CONVERSATION_ID, ...event }),
		setConnected: (value) => {
			isConnected = value;
		},
	};
}

function attachment(): PendingAttachment {
	return {
		id: "att-1",
		name: "OP_Manager_v176.html",
		mimeType: "text/html",
		size: 13,
		data: FILE_DATA,
		dataUrl: `data:text/html;base64,${FILE_DATA}`,
	};
}

function startToolCall(h: Harness): void {
	h.receive({
		type: SERVER_EVENT_TYPES.TOOL_CALL_START,
		callId: "call-1",
		toolName: "Bash",
		args: { command: "pnpm dev" },
	});
}

describe("a run that fails reaches the user", () => {
	it("ends the run with the reason, and leaves no tool running", () => {
		const h = harness();
		h.conversation.sendUserMessage("reproduire sans casser le design", [
			attachment(),
		]);
		startToolCall(h);
		h.receive({
			type: SERVER_EVENT_TYPES.RUN_ERROR,
			error: "The agent stopped before finishing its answer.",
		});
		const messages = h.conversation.messages.value;
		expect(h.conversation.isRunning.value).toBe(false);
		expect(messages.at(-1)).toMatchObject({
			role: MESSAGE_ROLES.ERROR,
			content: "The agent stopped before finishing its answer.",
		});
		expect(messages.find((m) => m.role === MESSAGE_ROLES.TOOL)).toMatchObject({
			status: TOOL_STATUS.ERROR,
			result: TOOL_CUT_SHORT_RESULT,
		});
	});

	it("says a message was not sent instead of waiting for an answer", () => {
		const h = harness();
		h.setConnected(false);
		h.conversation.sendUserMessage("reproduire sans casser le design");
		expect(h.conversation.isRunning.value).toBe(false);
		expect(h.conversation.messages.value.at(-1)).toMatchObject({
			role: MESSAGE_ROLES.ERROR,
			content: NOT_SENT_MESSAGE,
		});
	});

	it("retries the last message with its file", () => {
		const h = harness();
		h.conversation.sendUserMessage("reproduire sans casser le design", [
			attachment(),
		]);
		h.receive({ type: SERVER_EVENT_TYPES.RUN_ERROR, error: "API Error: 529" });
		h.conversation.retry();
		const resent = h.sent.filter(
			(msg) => msg.type === CLIENT_MESSAGE_TYPES.USER_MESSAGE,
		);
		expect(resent).toHaveLength(2);
		expect(resent[1]).toMatchObject({
			content: "reproduire sans casser le design",
			attachments: [{ name: "OP_Manager_v176.html", data: FILE_DATA }],
		});
		expect(h.conversation.isRunning.value).toBe(true);
	});

	it("asks for the files again when a reload dropped them", () => {
		const h = harness();
		h.receive({
			type: SERVER_EVENT_TYPES.CONVERSATION_SNAPSHOT,
			messages: [
				{
					role: "user",
					content: "reproduire sans casser le design",
					attachments: [
						{ name: "OP_Manager_v176.html", mimeType: "text/html", size: 13 },
					],
					timestampMs: 1,
				},
				{ role: "error", content: "The run was stopped.", timestampMs: 2 },
			],
		});
		h.conversation.retry();
		expect(h.sent).toEqual([]);
		expect(h.conversation.messages.value.at(-1)).toMatchObject({
			content: RETRY_NEEDS_FILES_MESSAGE,
		});
	});

	it("shows a stored error and settles tools left open after a reload", () => {
		const h = harness();
		h.receive({
			type: SERVER_EVENT_TYPES.CONVERSATION_SNAPSHOT,
			messages: [
				{ role: "user", content: "go", timestampMs: 1 },
				{
					role: "tool_use",
					content: "{}",
					toolName: "Bash",
					callId: "call-1",
					timestampMs: 2,
				},
				{ role: "error", content: "The run was stopped.", timestampMs: 3 },
			],
		});
		const [, tool, error] = h.conversation.messages.value;
		expect(tool).toMatchObject({ status: TOOL_STATUS.ERROR });
		expect(error).toMatchObject({
			role: MESSAGE_ROLES.ERROR,
			content: "The run was stopped.",
		});
	});

	it("lets the run go when Stop cannot reach the assistant", () => {
		const h = harness();
		h.conversation.sendUserMessage("go");
		h.setConnected(false);
		h.conversation.interrupt();
		expect(h.conversation.isRunning.value).toBe(false);
		expect(h.conversation.messages.value.at(-1)).toMatchObject({
			content: STOP_NOT_DELIVERED_MESSAGE,
		});
	});
});

describe("a run that keeps working shows it", () => {
	it("keeps what the agent reports, and when it last heard from the sidecar", () => {
		const h = harness();
		h.conversation.sendUserMessage("go");
		const before = h.conversation.lastEventAtMs.value;
		h.receive({
			type: SERVER_EVENT_TYPES.RUN_PROGRESS,
			activity: "writing",
			detail: "Write",
			elapsedMs: 42_000,
			idleMs: 1_000,
		});
		expect(h.conversation.isTurnInFlight.value).toBe(true);
		expect(h.conversation.progress.value).toMatchObject({
			activity: "writing",
			detail: "Write",
			elapsedMs: 42_000,
		});
		expect(h.conversation.lastEventAtMs.value).toBeGreaterThanOrEqual(before);
	});

	it("forgets the progress once the run is over", () => {
		const h = harness();
		h.conversation.sendUserMessage("go");
		h.receive({
			type: SERVER_EVENT_TYPES.RUN_PROGRESS,
			activity: "thinking",
			elapsedMs: 0,
			idleMs: 0,
		});
		h.receive({ type: SERVER_EVENT_TYPES.RUN_DONE });
		expect(h.conversation.progress.value).toBeNull();
		expect(h.conversation.isTurnInFlight.value).toBe(false);
		expect(h.conversation.isRunning.value).toBe(false);
	});
});
