export const MESSAGE_ROLES = {
	USER: "user",
	ASSISTANT: "assistant",
	TOOL: "tool",
} as const;

export const STORED_TOOL_USE_ROLE = "tool_use";
export const STORED_TOOL_RESULT_ROLE = "tool_result";

export const TOOL_STATUS = {
	PENDING: "pending",
	SUCCESS: "success",
	ERROR: "error",
} as const;

export const TODO_WRITE_TOOL_NAME = "TodoWrite";

export const TODO_STATUS = {
	PENDING: "pending",
	IN_PROGRESS: "in_progress",
	COMPLETED: "completed",
} as const;

export const TODO_PANEL_TITLE = "Plan";

export const STORAGE_CONVERSATION_ID_KEY = "dms-ai-conversation-id";

export const SEND_HOTKEY = "Enter";
export const NEWLINE_HOTKEY_MODIFIER = "shiftKey";

export const ROLE_LABELS = {
	USER: "You",
	ASSISTANT: "Assistant",
	TOOL: "Tool",
} as const;

export const STATUS_LABELS = {
	PENDING: "running",
	SUCCESS: "success",
	ERROR: "error",
} as const;

export const ERROR_PREFIX = "[error] ";

export const THINKING_LABEL = "Thinking…";

export const TOOL_CLUSTER_LABEL = "Used";

// A live cluster peeks only its most recent rows; the rest hide behind a reveal.
export const TOOL_CLUSTER_VISIBLE_LIMIT = 3;

// How long a cluster stays open after it stops being the active workspace, so a
// fast hand-off to the next cluster doesn't flash.
export const TOOL_CLUSTER_COLLAPSE_LINGER_MS = 600;
