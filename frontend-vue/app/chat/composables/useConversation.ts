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
import { CLIENT_MESSAGE_TYPES, SERVER_EVENT_TYPES } from "../constants/protocol";
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
import { newUuid } from "../utils/ids";
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

interface RunErrorEvent {
	type: typeof SERVER_EVENT_TYPES.RUN_ERROR;
	conversationId: string;
	error: string;
	isRetryable?: boolean;
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

/** A file as it travels to the sidecar: its bytes base64-encoded. */
interface WireAttachment {
	name: string;
	mimeType: string;
	size: number;
	data: string;
}

/** A file as an echo describes it: no bytes. */
interface AttachmentMeta {
	name: string;
	mimeType: string;
	size: number;
}

interface QueuedItemWire {
	id: string;
	content: string;
	attachments?: WireAttachment[];
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
	attachments?: AttachmentMeta[];
	timestampMs: number;
}

function newId(): string {
	return newUuid();
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

function lastUserMessage(list: ConversationMessage[]): UserMessage | undefined {
	for (let index = list.length - 1; index >= 0; index -= 1) {
		const message = list[index];
		if (isUserMessage(message)) return message;
	}
	return undefined;
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

interface ConversationState {
	options: UseConversationOptions;
	messages: Ref<ConversationMessage[]>;
	isRunning: Ref<boolean>;
	queued: Ref<QueuedMessage[]>;
	progress: Ref<RunProgress | null>;
	isTurnInFlight: Ref<boolean>;
	lastEventAtMs: Ref<number>;
}

type EventHandler = (state: ConversationState, event: any) => void;

function appendMessage(
	state: ConversationState,
	message: ConversationMessage,
): void {
	state.messages.value = [...state.messages.value, message];
}

function appendError(
	state: ConversationState,
	error: string,
	isRetryable = true,
): void {
	appendMessage(state, buildErrorMessage(error, isRetryable));
}

function expectTurn(state: ConversationState): void {
	state.isTurnInFlight.value = true;
	state.lastEventAtMs.value = Date.now();
}

function endTurn(state: ConversationState): void {
	state.messages.value = settlePendingTools(state.messages.value);
	state.progress.value = null;
	state.isTurnInFlight.value = false;
}

/**
 * The follow-up queue is server-owned: the client only reflects QUEUE_STATE
 * and drives it via QUEUE_ENQUEUE / QUEUE_CANCEL. On a turn's terminal event
 * the run stays "running" while the server still has queued items to drain
 * (it starts the next turn itself); it settles only once the queue is empty.
 */
function settleOrKeepRunning(state: ConversationState): void {
	state.isRunning.value = state.queued.value.length > 0;
}

/**
 * A snapshot is sent only on (re)attach and always precedes RUN_RESUMED. It
 * clears the optimistic running flag so a turn that ended while the chat was
 * disconnected cannot strand it; a live turn re-asserts it via the RUN_RESUMED
 * that follows.
 */
function applySnapshot(state: ConversationState, event: SnapshotEvent): void {
	state.messages.value = snapshotToMessages(event.messages);
	state.isRunning.value = false;
	state.progress.value = null;
	state.isTurnInFlight.value = false;
}

function toPendingAttachment(wire: WireAttachment): PendingAttachment {
	return {
		id: newId(),
		name: wire.name,
		mimeType: wire.mimeType,
		size: wire.size,
		data: wire.data,
		dataUrl: `data:${wire.mimeType};base64,${wire.data}`,
	};
}

function applyQueueState(state: ConversationState, event: QueueStateEvent): void {
	state.queued.value = event.items.map((item) => ({
		id: item.id,
		content: item.content,
		attachments: (item.attachments ?? []).map(toPendingAttachment),
	}));
}

function withAttachments(
	attachments: MessageAttachment[],
): MessageAttachment[] | undefined {
	return attachments.length > 0 ? attachments : undefined;
}

/**
 * The server dequeued a follow-up and is about to run it: its user bubble shows
 * now, since the client did not echo it locally (the server owns the queue).
 * Its attachments are metadata only.
 */
function applyUserEcho(
	state: ConversationState,
	event: UserMessageEchoEvent,
): void {
	const attachments = (event.attachments ?? []).map((a) => ({
		...a,
		dataUrl: "",
	}));
	appendMessage(
		state,
		buildUserMessage(event.content, withAttachments(attachments)),
	);
}

function forwardPermissionRequest(
	state: ConversationState,
	event: PermissionRequestEvent,
): void {
	state.options.onPermissionRequest?.(toPermissionRequestData(event));
}

function forwardQuestion(state: ConversationState, event: AskQuestionEvent): void {
	state.options.onQuestionRequest?.(toQuestionRequestData(event));
}

function applyProgress(state: ConversationState, event: RunProgressEvent): void {
	state.progress.value = toRunProgress(event);
	state.isRunning.value = true;
	state.isTurnInFlight.value = true;
}

const EVENT_HANDLERS: Record<string, EventHandler> = {
	[SERVER_EVENT_TYPES.ASSISTANT_MESSAGE_CHUNK]: (state, event: ChunkEvent) => {
		state.messages.value = appendChunk(state.messages.value, event.text);
	},
	[SERVER_EVENT_TYPES.TOOL_CALL_START]: (state, event: ToolStartEvent) => {
		state.messages.value = upsertToolCall(state.messages.value, event);
	},
	[SERVER_EVENT_TYPES.TOOL_CALL_END]: (state, event: ToolEndEvent) => {
		state.messages.value = applyToolEnd(state.messages.value, event);
	},
	[SERVER_EVENT_TYPES.RUN_DONE]: (state) => {
		endTurn(state);
		settleOrKeepRunning(state);
	},
	[SERVER_EVENT_TYPES.RUN_RESUMED]: (state) => {
		state.isRunning.value = true;
		expectTurn(state);
	},
	[SERVER_EVENT_TYPES.RUN_ERROR]: (state, event: RunErrorEvent) => {
		endTurn(state);
		appendError(state, event.error, event.isRetryable ?? true);
		settleOrKeepRunning(state);
	},
	[SERVER_EVENT_TYPES.RUN_PROGRESS]: applyProgress,
	[SERVER_EVENT_TYPES.CONVERSATION_SNAPSHOT]: applySnapshot,
	[SERVER_EVENT_TYPES.PERMISSION_REQUEST]: forwardPermissionRequest,
	[SERVER_EVENT_TYPES.ASK_QUESTION]: forwardQuestion,
	[SERVER_EVENT_TYPES.QUEUE_STATE]: applyQueueState,
	[SERVER_EVENT_TYPES.USER_MESSAGE_ECHO]: applyUserEcho,
};

/**
 * Events of a conversation the user switched away from are dropped: its run
 * keeps streaming server-side, and the chat catches up when it comes back.
 */
function isForActiveConversation(state: ConversationState, msg: unknown): boolean {
	const eventId = getConversationId(msg);
	return eventId === null || eventId === state.options.activeId.value;
}

function dispatch(state: ConversationState, msg: unknown): void {
	const type = getEventType(msg);
	if (type === null) return;
	const handler = EVENT_HANDLERS[type];
	if (handler === undefined) return;
	if (!isForActiveConversation(state, msg)) return;
	state.lastEventAtMs.value = Date.now();
	handler(state, msg);
}

function toWireAttachments(attachments: PendingAttachment[]): WireAttachment[] {
	return attachments.map((a) => ({
		name: a.name,
		mimeType: a.mimeType,
		size: a.size,
		data: a.data,
	}));
}

function toLocalAttachments(
	attachments: PendingAttachment[],
): MessageAttachment[] {
	return attachments.map((a) => ({
		name: a.name,
		mimeType: a.mimeType,
		size: a.size,
		dataUrl: a.dataUrl,
	}));
}

function queueFollowUp(
	state: ConversationState,
	content: string,
	attachments: PendingAttachment[],
): void {
	const wire = toWireAttachments(attachments);
	const isQueued = state.options.send({
		type: CLIENT_MESSAGE_TYPES.QUEUE_ENQUEUE,
		conversationId: state.options.activeId.value,
		item: {
			id: newId(),
			content,
			...(wire.length > 0 ? { attachments: wire } : {}),
		},
	});
	if (!isQueued) appendError(state, NOT_SENT_MESSAGE);
}

function startTurn(
	state: ConversationState,
	content: string,
	attachments: PendingAttachment[],
): void {
	const wire = toWireAttachments(attachments);
	const isSent = state.options.send({
		type: CLIENT_MESSAGE_TYPES.USER_MESSAGE,
		conversationId: state.options.activeId.value,
		content,
		...(wire.length > 0 ? { attachments: wire } : {}),
	});
	const message = buildUserMessage(
		content,
		withAttachments(toLocalAttachments(attachments)),
	);
	appendMessage(state, markUnsent(message, isSent));
	if (!isSent) {
		appendError(state, NOT_SENT_MESSAGE);
		return;
	}
	state.isRunning.value = true;
	expectTurn(state);
}

/**
 * While a turn is running, a follow-up is handed to the server-owned queue
 * (QUEUE_ENQUEUE); the server drains it into its own turn and echoes the user
 * bubble (USER_MESSAGE_ECHO) at that point, so it appears exactly once when
 * it runs. An idle send starts a turn immediately and echoes locally.
 */
function sendUserMessage(
	state: ConversationState,
	content: string,
	attachments: PendingAttachment[],
): void {
	const trimmed = content.trim();
	if (trimmed.length === 0 && attachments.length === 0) return;
	if (state.isRunning.value) {
		queueFollowUp(state, trimmed, attachments);
		return;
	}
	startTurn(state, trimmed, attachments);
}

function retry(state: ConversationState): void {
	const last = lastUserMessage(state.messages.value);
	if (last === undefined) return;
	const attachments = toResendableAttachments(last.attachments);
	if (attachments === null) {
		appendError(state, RETRY_NEEDS_FILES_MESSAGE, false);
		return;
	}
	if (last.isUnsent === true) {
		state.messages.value = state.messages.value.filter(
			(msg) => msg.id !== last.id,
		);
	}
	sendUserMessage(state, last.content, attachments);
}

function cancelQueued(state: ConversationState, id: string): void {
	state.options.send({
		type: CLIENT_MESSAGE_TYPES.QUEUE_CANCEL,
		conversationId: state.options.activeId.value,
		id,
	});
}

/**
 * Asks the sidecar to interrupt the live turn, leaving `isRunning` for the
 * resulting RUN_DONE to flip, so the UI tracks the real turn lifecycle. When
 * the request cannot even leave, nothing ever will: the run is let go here.
 */
function interrupt(state: ConversationState): void {
	if (!state.isRunning.value) return;
	const isSent = state.options.send({
		type: CLIENT_MESSAGE_TYPES.INTERRUPT_TURN,
		conversationId: state.options.activeId.value,
	});
	if (isSent) return;
	endTurn(state);
	state.isRunning.value = false;
	appendError(state, STOP_NOT_DELIVERED_MESSAGE);
}

function reset(state: ConversationState): void {
	state.messages.value = [];
	state.isRunning.value = false;
	state.queued.value = [];
	state.progress.value = null;
	state.isTurnInFlight.value = false;
}

function createConversationState(
	options: UseConversationOptions,
): ConversationState {
	return {
		options,
		messages: ref<ConversationMessage[]>([]),
		isRunning: ref(false),
		queued: ref<QueuedMessage[]>([]),
		progress: ref<RunProgress | null>(null),
		isTurnInFlight: ref(false),
		lastEventAtMs: ref(Date.now()),
	};
}

export function useConversation(
	options: UseConversationOptions,
): UseConversationResult {
	const state = createConversationState(options);
	options.onMessage((msg) => dispatch(state, msg));
	return {
		messages: state.messages,
		isRunning: state.isRunning,
		queued: state.queued,
		progress: state.progress,
		isTurnInFlight: state.isTurnInFlight,
		lastEventAtMs: state.lastEventAtMs,
		sendUserMessage: (content, attachments = []) =>
			sendUserMessage(state, content, attachments),
		retry: () => retry(state),
		cancelQueued: (id) => cancelQueued(state, id),
		interrupt: () => interrupt(state),
		reset: () => reset(state),
	};
}
