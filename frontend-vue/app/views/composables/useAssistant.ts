import { inject } from "vue";
import { useDmsRouter } from "#dms/frontend-module";
import { ASSISTANT_SESSION_KEY } from "../../runtime/assistant-session";

export interface AssistantActions {
	/** The assistant runs in this tab: its buttons can be offered. */
	isAvailable: boolean;
	openPanel: () => void;
	openConversation: (conversationId: string) => void;
	startConversation: (prompt?: string) => void;
	/** Opens a dashboard page, as its own links do. */
	goTo: (path: string) => void;
}

/**
 * The tab's assistant session as the workspace views use it. Without one
 * (production, sidecar disabled) the actions do nothing and `isAvailable`
 * hides the buttons that need them.
 */
export function useAssistant(): AssistantActions {
	const session = inject(ASSISTANT_SESSION_KEY, null);
	const router = useDmsRouter();
	return {
		isAvailable: session !== null,
		openPanel: () => session?.panel.open(),
		openConversation: (conversationId) =>
			session?.openConversation(conversationId),
		startConversation: (prompt) => session?.startConversation(prompt),
		goTo: (path) => void router.push(path),
	};
}
