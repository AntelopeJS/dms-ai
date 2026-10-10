import type {
	PermissionKind,
	PermissionPreview,
	PermissionRule,
} from "./protocol";

/**
 * A permission request as the approvals dock shows it. Every field past
 * `summary` came with the redesign and is defaulted when a sidecar leaves it
 * out, so an older request still renders, as a generic card.
 */
export interface PermissionRequestData {
	requestId: string;
	conversationId: string;
	callId?: string;
	toolName: string;
	args: unknown;
	summary: string;
	kind: PermissionKind;
	alwaysAsk: boolean;
	preview: PermissionPreview;
	ruleOptions: PermissionRule[];
	createdAtMs: number;
	/** Null when the sidecar gave no deadline. */
	expiresAtMs: number | null;
}

/** A request the sidecar denied for want of an answer, kept until dismissed. */
export interface ExpiredRequest {
	requestId: string;
	conversationId: string;
	toolName: string;
	summary: string;
	expiredAtMs: number;
}

/** What the user chose on a card, before it becomes a wire message. */
export interface PermissionAnswer {
	decision: "allow_once" | "allow_rule" | "deny";
	rule?: PermissionRule;
	feedback?: string;
	keepData?: boolean;
}
