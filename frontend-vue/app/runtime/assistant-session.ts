import type { InjectionKey, Ref } from "vue";
import type { ChatApi } from "../chat/composables/useChangeSetActions";
import type { CurrentPage } from "../chat/types/conversation";
import type { ChatTransport } from "./chat-transport";
import type { PanelIntents } from "./panel-intents";
import type { ChatPanelState } from "./panel-state";
import type { SidecarStatus } from "./sidecar-status";

/**
 * The tab's assistant, as the plugin that owns it hands it to the panel and to
 * the workspace pages: the sidecar's reachability, the chat's side of the
 * tab's stream, the panel's own state, and ways to open it on a chat.
 */
export interface AssistantSession {
	status: Readonly<Ref<SidecarStatus>>;
	chat: ChatTransport;
	panel: ChatPanelState;
	/** Opens a page of the dashboard, as its own links do. */
	navigate: (path: string) => void;
	/** Opens the panel on that conversation. */
	openConversation: (conversationId: string) => void;
	/** Opens the panel on a new conversation, the composer optionally prefilled. */
	startConversation: (prompt?: string) => void;
	/** Requests waiting for an answer, across every chat. */
	pendingApprovals: Readonly<Ref<number>>;
	/** What the panel was asked to do and has not done yet. */
	intents: PanelIntents;
	/** The page the dashboard shows. */
	currentPage: Readonly<Ref<CurrentPage | null>>;
	/** The dashboard's authenticated requests, for the panel's own HTTP calls. */
	api: ChatApi;
	/** Why the sidecar last failed to start, when the backend knows. */
	lastError: Readonly<Ref<string | null>>;
	/** Asks the backend to restart the sidecar, then probes it again. */
	restart: () => Promise<void>;
}

export const ASSISTANT_SESSION_KEY: InjectionKey<AssistantSession> = Symbol(
	"dms-ai:assistant-session",
);
