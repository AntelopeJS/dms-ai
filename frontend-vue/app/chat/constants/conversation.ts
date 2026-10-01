export const MESSAGE_ROLES = {
	USER: "user",
	ASSISTANT: "assistant",
	TOOL: "tool",
	ERROR: "error",
} as const;

export const STORED_TOOL_USE_ROLE = "tool_use";
export const STORED_TOOL_RESULT_ROLE = "tool_result";
export const STORED_ERROR_ROLE = "error";

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
	ERROR: "The run did not finish",
} as const;

export const STATUS_LABELS = {
	PENDING: "running",
	SUCCESS: "success",
	ERROR: "error",
} as const;

/** Shown when a message could not even leave the chat. */
export const NOT_SENT_MESSAGE =
	"Your message was not sent: the assistant is not connected. Reconnect, then retry.";

/** Shown when a retry needs files that only the original message still had. */
export const RETRY_NEEDS_FILES_MESSAGE =
	"Attach the files again to retry: they are no longer available after a reload.";

/** Shown when Stop could not reach the sidecar, so the run is let go locally. */
export const STOP_NOT_DELIVERED_MESSAGE =
	"The assistant could not be reached to stop the run. Reconnect to see where it stands.";

/** Result given to a tool that was still running when its run ended. */
export const TOOL_CUT_SHORT_RESULT = "The run ended before this tool finished.";

export const RETRY_LABEL = "Retry";

export const TOOL_CLUSTER_LABEL = "Used";

/**
 * A live cluster peeks only its most recent rows; the rest hide behind a
 * reveal.
 */
export const TOOL_CLUSTER_VISIBLE_LIMIT = 3;

/**
 * How long a cluster stays open after it stops being the active workspace, so
 * a fast hand-off to the next cluster doesn't flash.
 */
export const TOOL_CLUSTER_COLLAPSE_LINGER_MS = 600;
