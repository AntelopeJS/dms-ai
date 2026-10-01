import type { InjectionKey, Ref } from 'vue'
import type { ChatTransport } from './chat-transport'
import type { ChatPanelState } from './panel-state'
import type { SidecarStatus } from './sidecar-status'

/**
 * What the chat panel needs from the plugin that owns the tab's assistant: the
 * sidecar's reachability, the chat's side of the tab's stream, the panel's own
 * state, and the dashboard's router.
 */
export interface AssistantSession {
	status: Readonly<Ref<SidecarStatus>>
	chat: ChatTransport
	panel: ChatPanelState
	/** Opens a page of the dashboard, as its own links do. */
	navigate: (path: string) => void
}

export const ASSISTANT_SESSION_KEY: InjectionKey<AssistantSession> = Symbol(
	'dms-ai:assistant-session',
)
