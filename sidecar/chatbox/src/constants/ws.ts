export const WS_IFRAME_PATH = "/ws/iframe";

export const CLIENT_MESSAGE_TYPES = {
	HELLO: "hello",
	USER_MESSAGE: "user_message",
	PERMISSION_RESPONSE: "permission_response",
	QUESTION_RESPONSE: "question_response",
	LIST_CONVERSATIONS: "list_conversations",
	DELETE_CONVERSATION: "delete_conversation",
	SET_SETTINGS: "set_settings",
	REQUEST_HOST_NAVIGATE: "request_host_navigate",
	INTERRUPT_TURN: "interrupt_turn",
	QUEUE_ENQUEUE: "queue_enqueue",
	QUEUE_CANCEL: "queue_cancel",
} as const;

// Route of the dms-ai Settings admin page, reached from the chatbox cogwheel.
// Module pages live under `/modules/<moduleId>/<slug>`.
export const SETTINGS_PAGE_PATH = "/modules/ai/settings";

export const SERVER_EVENT_TYPES = {
	ASSISTANT_MESSAGE_CHUNK: "assistant_message_chunk",
	TOOL_CALL_START: "tool_call_start",
	TOOL_CALL_END: "tool_call_end",
	RUN_DONE: "run_done",
	RUN_ERROR: "run_error",
	RUN_RESUMED: "run_resumed",
	CONVERSATION_SNAPSHOT: "conversation_snapshot",
	CONVERSATION_LIST: "conversation_list",
	SETTINGS_UPDATE: "settings_update",
	PERMISSION_REQUEST: "permission_request",
	ASK_QUESTION: "ask_question",
	QUEUE_STATE: "queue_state",
	USER_MESSAGE_ECHO: "user_message_echo",
} as const;

export const ROLES = {
	IFRAME: "iframe",
	HOST: "host",
} as const;

export const MOUNT_SELECTOR = "#app";

export const WS_PROTOCOLS = { SECURE: "wss:", INSECURE: "ws:" } as const;
export const PAGE_PROTOCOL_SECURE = "https:";

export const WS_RECONNECT_DELAYS_MS = [
	1000, 2000, 4000, 8000, 15000, 30000,
] as const;

export const CONNECTION_STATUSES = {
	CONNECTING: "connecting",
	CONNECTED: "connected",
	DISCONNECTED: "disconnected",
	RECONNECTING: "reconnecting",
} as const;

export type ConnectionStatus =
	(typeof CONNECTION_STATUSES)[keyof typeof CONNECTION_STATUSES];
