import { type Ref, ref } from "vue";
import {
	MESSAGE_ROLES,
	NOT_SENT_MESSAGE,
	RETRY_NEEDS_FILES_MESSAGE,
	STOP_NOT_DELIVERED_MESSAGE,
	STORED_ERROR_ROLE,
	STORED_TOOL_RESULT_ROLE,
	STORED_TOOL_USE_ROLE,
	TOOL_CUT_SHORT_RESULT,
	TOOL_STATUS,
} from "../constants/conversation";
import { CLIENT_MESSAGE_TYPES, SERVER_EVENT_TYPES } from "../constants/ws";
import type {
	AssistantMessage,
	ConversationMessage,
	ErrorMessage,
	MessageAttachment,
	QueuedMessage,
	RunProgress,
	ToolCallMessage,
	ToolStatus,
	UserMessage,
} from "../types/conversation";
import type { PermissionRequestData } from "../types/permission";
import type { QuestionData, QuestionRequestData } from "../types/question";
import { type PendingAttachment, splitDataUrl } from "../utils/attachments";
import { toActivityKind } from "../utils/run-status";

export interface UseConversationOptions {
	activeId: Ref<string>;
	/** Returns false when the message could not leave the chatbox. */
	send: (msg: object) => boolean;
	onMessage: (handler: (msg: unknown) => void) => () => void;
	onPermissionRequest?: (req: PermissionRequestData) => void;
	onQuestionRequest?: (req: QuestionRequestData) => void;
}

export interface UseConversationResult {
	messages: Ref<ConversationMessage[]>;
	isRunning: Ref<boolean>;
	queued: Ref<QueuedMessage[]>;
	/** What the running turn is doing, as last reported; null between turns. */
	progress: Ref<RunProgress | null>;
	/** Whether a turn is expected to report: sent, resumed, or reporting. */
	isTurnInFlight: Ref<boolean>;
	/** Local time of the last event the sidecar sent about this conversation. */
	lastEventAtMs: Ref<number>;
	sendUserMessage: (content: string, attachments?: PendingAttachment[]) => void;
	/** Sends the last user message again, with its files when still at hand. */
	retry: () => void;
	cancelQueued: (id: string) => void;
	interrupt: () => void;
	reset: () => void;
}

interface SnapshotMessage {
	role: string;
	content: string;
	toolName?: string;
	callId?: string;
	status?: string;
	attachments?: MessageAttachment[];
	isRetryable?: boolean;
	timestampMs: number;
}

interface ChunkEvent {
	type: typeof SERVER_EVENT_TYPES.ASSISTANT_MESSAGE_CHUNK;
	conversationId: string;
	text: string;
}

interface ToolStartEvent {
	type: typeof SERVER_EVENT_TYPES.TOOL_CALL_START;
	conversationId: string;
	callId: string;
	toolName: string;
	args: unknown;
}

interface ToolEndEvent {
	type: typeof SERVER_EVENT_TYPES.TOOL_CALL_END;
	conversationId: string;
	callId: string;
	status: "success" | "error";
	result: unknown;
}

interface RunDoneEvent {
	type: typeof SERVER_EVENT_TYPES.RUN_DONE;
	conversationId: string;
}

interface RunErrorEvent {
	type: typeof SERVER_EVENT_TYPES.RUN_ERROR;
	conversationId: string;
	error: string;
	isRetryable?: boolean;
}

interface RunResumedEvent {
	type: typeof SERVER_EVENT_TYPES.RUN_RESUMED;
	conversationId: string;
}

interface RunProgressEvent {
	type: typeof SERVER_EVENT_TYPES.RUN_PROGRESS;
	conversationId: string;
	activity: string;
	detail?: string;
	elapsedMs: number;
	idleMs: number;
}

interface SnapshotEvent {
	type: typeof SERVER_EVENT_TYPES.CONVERSATION_SNAPSHOT;
	conversationId: string;
	messages: SnapshotMessage[];
}

interface PermissionRequestEvent {
	type: typeof SERVER_EVENT_TYPES.PERMISSION_REQUEST;
	conversationId: string;
	requestId: string;
	toolName: string;
	args: unknown;
	summary: string;
}

interface AskQuestionEvent {
	type: typeof SERVER_EVENT_TYPES.ASK_QUESTION;
	conversationId: string;
	requestId: string;
	questions: QuestionData[];
}

interface QueuedItemWire {
	id: string;
	content: string;
	attachments?: {
		name: string;
		mimeType: string;
		size: number;
		data: string;
	}[];
}

interface QueueStateEvent {
	type: typeof SERVER_EVENT_TYPES.QUEUE_STATE;
	conversationId: string;
	items: QueuedItemWire[];
}

interface UserMessageEchoEvent {
	type: typeof SERVER_EVENT_TYPES.USER_MESSAGE_ECHO;
	conversationId: string;
	content: string;
	attachments?: { name: string; mimeType: string; size: number }[];
	timestampMs: number;
}

function newId(): string {
	return crypto.randomUUID();
}

function buildUserMessage(
	content: string,
	attachments?: MessageAttachment[],
): UserMessage {
	return {
		id: newId(),
		role: MESSAGE_ROLES.USER,
		content,
		attachments,
		timestampMs: Date.now(),
	};
}

function markUnsent(message: UserMessage, isSent: boolean): UserMessage {
	return isSent ? message : { ...message, isUnsent: true };
}

function buildAssistantMessage(text: string): AssistantMessage {
	return {
		id: newId(),
		role: MESSAGE_ROLES.ASSISTANT,
		content: text,
		timestampMs: Date.now(),
	};
}

function buildToolCallMessage(event: ToolStartEvent): ToolCallMessage {
	return {
		id: newId(),
		role: MESSAGE_ROLES.TOOL,
		callId: event.callId,
		toolName: event.toolName,
		args: event.args,
		status: TOOL_STATUS.PENDING,
		timestampMs: Date.now(),
	};
}

function appendChunk(
	list: ConversationMessage[],
	text: string,
): ConversationMessage[] {
	const last = list.at(-1);
	if (last !== undefined && last.role === MESSAGE_ROLES.ASSISTANT) {
		const updated: AssistantMessage = { ...last, content: last.content + text };
		return [...list.slice(0, -1), updated];
	}
	return [...list, buildAssistantMessage(text)];
}

function upsertToolCall(
	list: ConversationMessage[],
	event: ToolStartEvent,
): ConversationMessage[] {
	const exists = list.some(
		(msg) => msg.role === MESSAGE_ROLES.TOOL && msg.callId === event.callId,
	);
	if (!exists) return [...list, buildToolCallMessage(event)];
	return list.map((msg) => {
		if (msg.role !== MESSAGE_ROLES.TOOL || msg.callId !== event.callId) {
			return msg;
		}
		return {
			...msg,
			toolName: event.toolName,
			args: event.args,
			status: TOOL_STATUS.PENDING,
		};
	});
}

function applyToolEnd(
	list: ConversationMessage[],
	event: ToolEndEvent,
): ConversationMessage[] {
	return list.map((msg) => {
		if (msg.role !== MESSAGE_ROLES.TOOL) return msg;
		if (msg.callId !== event.callId) return msg;
		return { ...msg, status: event.status, result: event.result };
	});
}

function normalizeToolStatus(raw: string | undefined): ToolStatus {
	if (raw === TOOL_STATUS.SUCCESS) return TOOL_STATUS.SUCCESS;
	if (raw === TOOL_STATUS.ERROR) return TOOL_STATUS.ERROR;
	return TOOL_STATUS.PENDING;
}

function safeParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function buildUserSnapshot(snap: SnapshotMessage): UserMessage {
	return {
		id: newId(),
		role: MESSAGE_ROLES.USER,
		content: snap.content,
		attachments: snap.attachments,
		timestampMs: snap.timestampMs,
	};
}

function buildAssistantSnapshot(snap: SnapshotMessage): AssistantMessage {
	return {
		id: newId(),
		role: MESSAGE_ROLES.ASSISTANT,
		content: snap.content,
		timestampMs: snap.timestampMs,
	};
}

function buildToolUseSnapshot(snap: SnapshotMessage): ToolCallMessage | null {
	if (snap.callId === undefined || snap.toolName === undefined) return null;
	return {
		id: newId(),
		role: MESSAGE_ROLES.TOOL,
		callId: snap.callId,
		toolName: snap.toolName,
		args: safeParse(snap.content),
		status: TOOL_STATUS.PENDING,
		timestampMs: snap.timestampMs,
	};
}

function applyToolResultSnapshot(
	out: ConversationMessage[],
	toolByCallId: Map<string, ToolCallMessage>,
	snap: SnapshotMessage,
): void {
	if (snap.callId === undefined) return;
	const result = safeParse(snap.content);
	const status = normalizeToolStatus(snap.status);
	const existing = toolByCallId.get(snap.callId);
	if (existing !== undefined) {
		existing.result = result;
		existing.status = status;
		return;
	}
	out.push({
		id: newId(),
		role: MESSAGE_ROLES.TOOL,
		callId: snap.callId,
		toolName: "",
		args: undefined,
		result,
		status,
		timestampMs: snap.timestampMs,
	});
}

function appendSnapshotItem(
	out: ConversationMessage[],
	toolByCallId: Map<string, ToolCallMessage>,
	item: SnapshotMessage,
): void {
	if (item.role === MESSAGE_ROLES.USER) {
		out.push(buildUserSnapshot(item));
		return;
	}
	if (item.role === STORED_ERROR_ROLE) {
		out.push(
			buildErrorMessage(
				item.content,
				item.isRetryable ?? true,
				item.timestampMs,
			),
		);
		return;
	}
	if (item.role === MESSAGE_ROLES.ASSISTANT) {
		out.push(buildAssistantSnapshot(item));
		return;
	}
	if (item.role === STORED_TOOL_USE_ROLE) {
		const message = buildToolUseSnapshot(item);
		if (message === null) return;
		out.push(message);
		toolByCallId.set(message.callId, message);
		return;
	}
	if (item.role === STORED_TOOL_RESULT_ROLE) {
		applyToolResultSnapshot(out, toolByCallId, item);
	}
}

function snapshotToMessages(snap: SnapshotMessage[]): ConversationMessage[] {
	const out: ConversationMessage[] = [];
	const toolByCallId = new Map<string, ToolCallMessage>();
	for (const item of snap) {
		appendSnapshotItem(out, toolByCallId, item);
	}
	return settlePendingTools(out);
}

function buildErrorMessage(
	error: string,
	isRetryable: boolean,
	timestampMs: number = Date.now(),
): ErrorMessage {
	return {
		id: newId(),
		role: MESSAGE_ROLES.ERROR,
		content: error,
		isRetryable,
		timestampMs,
	};
}

function isPendingTool(msg: ConversationMessage): msg is ToolCallMessage {
	return msg.role === MESSAGE_ROLES.TOOL && msg.status === TOOL_STATUS.PENDING;
}

function settlePendingTools(
	list: ConversationMessage[],
): ConversationMessage[] {
	if (!list.some(isPendingTool)) return list;
	return list.map((msg) => {
		if (!isPendingTool(msg)) return msg;
		return { ...msg, status: TOOL_STATUS.ERROR, result: TOOL_CUT_SHORT_RESULT };
	});
}

function toRunProgress(event: RunProgressEvent): RunProgress {
	return {
		activity: toActivityKind(event.activity),
		detail: event.detail,
		elapsedMs: event.elapsedMs,
		idleMs: event.idleMs,
		receivedAtMs: Date.now(),
	};
}

function isUserMessage(msg: ConversationMessage): msg is UserMessage {
	return msg.role === MESSAGE_ROLES.USER;
}

function toResendableAttachments(
	attachments: MessageAttachment[] | undefined,
): PendingAttachment[] | null {
	const list = attachments ?? [];
	if (list.some((att) => !att.dataUrl)) return null;
	return list.map((att) => ({
		id: newId(),
		name: att.name,
		mimeType: att.mimeType,
		size: att.size,
		data: splitDataUrl(att.dataUrl ?? ""),
		dataUrl: att.dataUrl ?? "",
	}));
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function getEventType(msg: unknown): string | null {
	if (!isObject(msg)) return null;
	const t = msg.type;
	return typeof t === "string" ? t : null;
}

function getConversationId(msg: unknown): string | null {
	if (!isObject(msg)) return null;
	const id = msg.conversationId;
	return typeof id === "string" ? id : null;
}

function toPermissionRequestData(
	event: PermissionRequestEvent,
): PermissionRequestData {
	return {
		requestId: event.requestId,
		conversationId: event.conversationId,
		toolName: event.toolName,
		args: event.args,
		summary: event.summary,
	};
}

function toQuestionRequestData(event: AskQuestionEvent): QuestionRequestData {
	return {
		requestId: event.requestId,
		conversationId: event.conversationId,
		questions: event.questions,
	};
}

export function useConversation(
	options: UseConversationOptions,
): UseConversationResult {
	const activeId = options.activeId;
	const messages = ref<ConversationMessage[]>([]);
	const isRunning = ref(false);
	const queued = ref<QueuedMessage[]>([]);
	const progress = ref<RunProgress | null>(null);
	const isTurnInFlight = ref(false);
	const lastEventAtMs = ref(Date.now());

	const appendError = (error: string, isRetryable = true): void => {
		messages.value = [...messages.value, buildErrorMessage(error, isRetryable)];
	};

	const expectTurn = (): void => {
		isTurnInFlight.value = true;
		lastEventAtMs.value = Date.now();
	};

	const endTurn = (): void => {
		messages.value = settlePendingTools(messages.value);
		progress.value = null;
		isTurnInFlight.value = false;
	};

	const echoUserMessage = (
		content: string,
		attachments: PendingAttachment[],
		isSent: boolean,
	): void => {
		const localAttachments: MessageAttachment[] = attachments.map((a) => ({
			name: a.name,
			mimeType: a.mimeType,
			size: a.size,
			dataUrl: a.dataUrl,
		}));
		const message = buildUserMessage(
			content,
			localAttachments.length > 0 ? localAttachments : undefined,
		);
		messages.value = [...messages.value, markUnsent(message, isSent)];
	};

	const sendTurnMessage = (
		content: string,
		attachments: PendingAttachment[],
	): boolean => {
		return options.send({
			type: CLIENT_MESSAGE_TYPES.USER_MESSAGE,
			conversationId: activeId.value,
			content,
			...(attachments.length > 0
				? {
						attachments: attachments.map((a) => ({
							name: a.name,
							mimeType: a.mimeType,
							size: a.size,
							data: a.data,
						})),
					}
				: {}),
		});
	};

	// The follow-up queue is server-owned: the client only reflects QUEUE_STATE
	// and drives it via QUEUE_ENQUEUE / QUEUE_CANCEL. On a turn's terminal event
	// the run stays "running" while the server still has queued items to drain
	// (it starts the next turn itself); it settles only once the queue is empty.
	const settleOrKeepRunning = (): void => {
		isRunning.value = queued.value.length > 0;
	};

	const handlers: Record<string, (msg: any) => void> = {
		[SERVER_EVENT_TYPES.ASSISTANT_MESSAGE_CHUNK]: (event: ChunkEvent) => {
			messages.value = appendChunk(messages.value, event.text);
		},
		[SERVER_EVENT_TYPES.TOOL_CALL_START]: (event: ToolStartEvent) => {
			messages.value = upsertToolCall(messages.value, event);
		},
		[SERVER_EVENT_TYPES.TOOL_CALL_END]: (event: ToolEndEvent) => {
			messages.value = applyToolEnd(messages.value, event);
		},
		[SERVER_EVENT_TYPES.RUN_DONE]: (_event: RunDoneEvent) => {
			endTurn();
			settleOrKeepRunning();
		},
		[SERVER_EVENT_TYPES.RUN_RESUMED]: (_event: RunResumedEvent) => {
			isRunning.value = true;
			expectTurn();
		},
		[SERVER_EVENT_TYPES.RUN_ERROR]: (event: RunErrorEvent) => {
			endTurn();
			appendError(event.error, event.isRetryable ?? true);
			settleOrKeepRunning();
		},
		[SERVER_EVENT_TYPES.RUN_PROGRESS]: (event: RunProgressEvent) => {
			progress.value = toRunProgress(event);
			isRunning.value = true;
			isTurnInFlight.value = true;
		},
		[SERVER_EVENT_TYPES.CONVERSATION_SNAPSHOT]: (event: SnapshotEvent) => {
			messages.value = snapshotToMessages(event.messages);
			// A snapshot is sent only on (re)attach and always precedes RUN_RESUMED.
			// Clear the optimistic running flag so a turn that ended while we were
			// disconnected can't strand it; a live turn re-asserts it via the
			// RUN_RESUMED that follows.
			isRunning.value = false;
			progress.value = null;
			isTurnInFlight.value = false;
		},
		[SERVER_EVENT_TYPES.PERMISSION_REQUEST]: (
			event: PermissionRequestEvent,
		) => {
			if (options.onPermissionRequest === undefined) return;
			options.onPermissionRequest(toPermissionRequestData(event));
		},
		[SERVER_EVENT_TYPES.ASK_QUESTION]: (event: AskQuestionEvent) => {
			if (options.onQuestionRequest === undefined) return;
			options.onQuestionRequest(toQuestionRequestData(event));
		},
		[SERVER_EVENT_TYPES.QUEUE_STATE]: (event: QueueStateEvent) => {
			queued.value = event.items.map((item) => ({
				id: item.id,
				content: item.content,
				attachments: (item.attachments ?? []).map((a) => ({
					id: newId(),
					name: a.name,
					mimeType: a.mimeType,
					size: a.size,
					data: a.data,
					dataUrl: `data:${a.mimeType};base64,${a.data}`,
				})),
			}));
		},
		// The server dequeued a follow-up and is about to run it — render its user
		// bubble now (the client did not echo it locally, since the server owns the
		// queue). Attachments are metadata only here.
		[SERVER_EVENT_TYPES.USER_MESSAGE_ECHO]: (event: UserMessageEchoEvent) => {
			const attachments = (event.attachments ?? []).map((a) => ({
				name: a.name,
				mimeType: a.mimeType,
				size: a.size,
				dataUrl: "",
			}));
			messages.value = [
				...messages.value,
				buildUserMessage(
					event.content,
					attachments.length > 0 ? attachments : undefined,
				),
			];
		},
	};

	const dispatch = (msg: unknown): void => {
		const type = getEventType(msg);
		if (type === null) return;
		const handler = handlers[type];
		if (handler === undefined) return;
		// Drop events that belong to a conversation the user has switched
		// away from (the previous run keeps streaming server-side).
		const eventId = getConversationId(msg);
		if (eventId !== null && eventId !== activeId.value) return;
		lastEventAtMs.value = Date.now();
		handler(msg);
	};

	options.onMessage(dispatch);

	const toWireAttachments = (
		attachments: PendingAttachment[],
	): { name: string; mimeType: string; size: number; data: string }[] =>
		attachments.map((a) => ({
			name: a.name,
			mimeType: a.mimeType,
			size: a.size,
			data: a.data,
		}));

	// While a turn is running, a follow-up is handed to the server-owned queue
	// (QUEUE_ENQUEUE); the server drains it into its own turn and echoes the user
	// bubble (USER_MESSAGE_ECHO) at that point, so it appears exactly once when it
	// runs. An idle send starts a turn immediately and echoes locally.
	const sendUserMessage = (
		content: string,
		attachments: PendingAttachment[] = [],
	): void => {
		const trimmed = content.trim();
		if (trimmed.length === 0 && attachments.length === 0) return;
		if (isRunning.value) {
			const wire = toWireAttachments(attachments);
			const isQueued = options.send({
				type: CLIENT_MESSAGE_TYPES.QUEUE_ENQUEUE,
				conversationId: activeId.value,
				item: {
					id: newId(),
					content: trimmed,
					...(wire.length > 0 ? { attachments: wire } : {}),
				},
			});
			if (!isQueued) appendError(NOT_SENT_MESSAGE);
			return;
		}
		const isSent = sendTurnMessage(trimmed, attachments);
		echoUserMessage(trimmed, attachments, isSent);
		if (!isSent) {
			appendError(NOT_SENT_MESSAGE);
			return;
		}
		isRunning.value = true;
		expectTurn();
	};

	const retry = (): void => {
		const last = messages.value.findLast(isUserMessage);
		if (last === undefined) return;
		const attachments = toResendableAttachments(last.attachments);
		if (attachments === null) {
			appendError(RETRY_NEEDS_FILES_MESSAGE, false);
			return;
		}
		if (last.isUnsent === true) {
			messages.value = messages.value.filter((msg) => msg.id !== last.id);
		}
		sendUserMessage(last.content, attachments);
	};

	const cancelQueued = (id: string): void => {
		options.send({
			type: CLIENT_MESSAGE_TYPES.QUEUE_CANCEL,
			conversationId: activeId.value,
			id,
		});
	};

	const interrupt = (): void => {
		if (!isRunning.value) return;
		const isSent = options.send({
			type: CLIENT_MESSAGE_TYPES.INTERRUPT_TURN,
			conversationId: activeId.value,
		});
		if (isSent) return;
		endTurn();
		isRunning.value = false;
		appendError(STOP_NOT_DELIVERED_MESSAGE);
	};

	const reset = (): void => {
		messages.value = [];
		isRunning.value = false;
		queued.value = [];
		progress.value = null;
		isTurnInFlight.value = false;
	};

	return {
		messages,
		isRunning,
		queued,
		progress,
		isTurnInFlight,
		lastEventAtMs,
		sendUserMessage,
		retry,
		cancelQueued,
		interrupt,
		reset,
	};
}
