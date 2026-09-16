import type { PendingAttachment } from "../utils/attachments";

export type MessageRole = "user" | "assistant" | "tool";
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
	| ToolCallMessage;

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
