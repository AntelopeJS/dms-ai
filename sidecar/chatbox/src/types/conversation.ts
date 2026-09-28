import type { PendingAttachment } from "../utils/attachments";

export type MessageRole = "user" | "assistant" | "tool" | "error";
export type ToolStatus = "pending" | "success" | "error";

// A file attached to a user message. `dataUrl` is only present for messages
// sent in this session (drives the image thumbnail); after a reload the snapshot
// carries just the metadata, so it is absent.
export interface MessageAttachment {
	name: string;
	mimeType: string;
	size: number;
	dataUrl?: string;
}

export interface UserMessage {
	id: string;
	role: "user";
	content: string;
	attachments?: MessageAttachment[];
	timestampMs: number;
}

export interface AssistantMessage {
	id: string;
	role: "assistant";
	content: string;
	timestampMs: number;
}

/** Why a run stopped or a message could not be sent, with a way to retry. */
export interface ErrorMessage {
	id: string;
	role: "error";
	content: string;
	timestampMs: number;
}

/**
 * What the running turn is doing, as last reported by the sidecar.
 * `receivedAtMs` is the local time of that report, from which the elapsed and
 * quiet durations keep counting until the next one.
 */
export interface RunProgress {
	activity: string;
	detail?: string;
	elapsedMs: number;
	idleMs: number;
	receivedAtMs: number;
}

export interface ToolCallMessage {
	id: string;
	role: "tool";
	callId: string;
	toolName: string;
	args: unknown;
	result?: unknown;
	status: ToolStatus;
	timestampMs: number;
}

export type ConversationMessage =
	| UserMessage
	| AssistantMessage
	| ToolCallMessage
	| ErrorMessage;

export interface QueuedMessage {
	id: string;
	content: string;
	attachments: PendingAttachment[];
}

export interface ConversationSummary {
	id: string;
	title: string;
	createdAtMs: number;
	updatedAtMs: number;
	messageCount: number;
}
