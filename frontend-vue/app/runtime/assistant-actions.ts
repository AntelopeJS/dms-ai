import type {
	AssistantSessionRef,
	ConversationStartMode,
} from "./assistant-session";

/**
 * The assistant as another module's layer may use it, without depending on dms-ai: injected under
 * {@link ASSISTANT_ACTIONS_KEY} with a `null` default, which is what a project without dms-ai, or
 * outside development, answers.
 */
export interface PublicAssistantActions {
	/** The assistant runs in this tab, so a button that starts a conversation can be offered. Reactive. */
	readonly isAvailable: boolean;
	/**
	 * Opens the assistant panel on a new conversation with `prompt` in the composer, unsent. With
	 * `mode`, the conversation is set to it first: `plan` makes the agent end with a plan to approve.
	 */
	startConversation: (
		prompt: string,
		options?: { mode?: ConversationStartMode },
	) => void;
}

/**
 * The global key of {@link PublicAssistantActions}: `Symbol.for` resolves to the same symbol in
 * every layer, so another module's layer injects it without importing dms-ai.
 */
export const ASSISTANT_ACTIONS_KEY = Symbol.for("dms-ai:assistant-actions");

/** The public actions over the tab's assistant session, which may not run yet, or ever. */
export function publicAssistantActions(
	session: AssistantSessionRef,
): PublicAssistantActions {
	return {
		get isAvailable() {
			return session.value !== null;
		},
		startConversation: (prompt, options) =>
			session.value?.startConversation(prompt, options?.mode),
	};
}
