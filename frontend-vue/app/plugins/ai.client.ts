import {
	type DmsAppContext,
	defineDmsPlugin,
	useDmsRouter,
} from '#dms/frontend-module'
import {
	type ChannelClient,
	createChannelClient,
} from '../runtime/channel-client'
import {
	createChatTransport,
	exposeChatTransport,
} from '../runtime/chat-transport'
import {
	CHANNEL_IDLE_STOP_MS,
	CHANNEL_STATUS_RECONNECTING,
	CHAT_CHANNEL,
	CHATBOX_PATH,
	HELLO_MESSAGE_TYPE,
	HOST_CHANNEL,
	HOST_ROLE,
	JSON_CONTENT_TYPE,
	SIDECAR_INFO_PATH,
	SIDECAR_STATUS_CONNECTED,
	SIDECAR_STATUS_REVIVING,
	SIDECAR_STATUS_UNAVAILABLE,
} from '../runtime/constants'
import {
	buildCurrentPageUpdate,
	installCurrentPageTracker,
} from '../runtime/current-page'
import { registerLauncherAction } from '../runtime/header-action'
import {
	createHostCommandDispatcher,
	type HostCommandDispatcher,
} from '../runtime/host-commands'
import { installNavigationCompleteEmitter } from '../runtime/navigation-complete'
import { injectOverlay, type OverlayHandle } from '../runtime/overlay'
import { runWhenLoggedIn } from '../runtime/session-gate'
import { installToggleShortcut } from '../runtime/shortcuts'
import {
	createSidecarStatusController,
	type SidecarStatus,
	type SidecarStatusController,
} from '../runtime/sidecar-status'

type AuthFetch = ReturnType<typeof useAuthFetch>['$authFetch']

interface ChannelDeps {
	$authFetch: AuthFetch
	controller: SidecarStatusController
	dispatchHostCommand: HostCommandDispatcher
}

function buildIframeUrl(): string {
	// Seed the chatbox with the host's current light/dark mode so its very first
	// paint matches; the theme bridge keeps it in sync from there on.
	const mode = document.documentElement.classList.contains('dark')
		? 'dark'
		: 'light'
	return `${CHATBOX_PATH}?theme=${mode}`
}

/**
 * The tab's one stream to the sidecar, carrying the host channel for the
 * dashboard and the chat channel it lends to the chat document. Every
 * connection is a new sidecar socket, so each one says hello and resends the
 * current page: the agent would otherwise only learn it at the next navigation.
 */
function createAssistantChannel(deps: ChannelDeps): ChannelClient {
	const chat = createChatTransport({
		send: (msg) => channel.send(CHAT_CHANNEL, msg),
		reconnect: () => channel.reconnectNow(),
		getStatus: () => channel.getStatus(),
	})
	const frameRoutes: Record<string, (raw: string) => void> = {
		[HOST_CHANNEL]: deps.dispatchHostCommand,
		[CHAT_CHANNEL]: chat.deliverFrame,
	}
	const channel = createChannelClient({
		channels: [HOST_CHANNEL, CHAT_CHANNEL],
		post: (path, body) =>
			deps.$authFetch(path, {
				method: 'POST',
				body: JSON.stringify(body),
				headers: { 'content-type': JSON_CONTENT_TYPE },
			}),
		onReady: () => {
			channel.send(HOST_CHANNEL, { type: HELLO_MESSAGE_TYPE, role: HOST_ROLE })
			channel.send(HOST_CHANNEL, buildCurrentPageUpdate(window.location.href))
			chat.announceReady()
		},
		onFrame: (name, raw) => frameRoutes[name]?.(raw),
		onStatusChange: (status) => {
			chat.announceStatus(status)
			// The sidecar went away, or dms-ai reloaded: re-probe, which revives
			// an idle-exited sidecar, rather than only waiting on the retries.
			if (status === CHANNEL_STATUS_RECONNECTING) deps.controller.reportChannelDown()
		},
	})
	exposeChatTransport(chat.transport)
	return channel
}

/**
 * The stream lives while the panel is open in a visible tab, and a little
 * after. A tab in the background holds no stream of its own: the browser's six
 * HTTP/1.1 connections to the dashboard are shared by every tab, and the DMS
 * already keeps two of them per tab.
 */
function followPanel(overlay: OverlayHandle, channel: ChannelClient): void {
	let stopTimer: ReturnType<typeof setTimeout> | null = null
	const follow = (): void => {
		if (stopTimer !== null) clearTimeout(stopTimer)
		stopTimer = null
		const isNeeded = overlay.isOpen() && document.visibilityState === 'visible'
		if (isNeeded) channel.start()
		else stopTimer = setTimeout(() => channel.stop(), CHANNEL_IDLE_STOP_MS)
	}
	overlay.onOpenChange(follow)
	document.addEventListener('visibilitychange', follow)
	follow()
}

function statusApplier(
	overlay: OverlayHandle,
	channel: ChannelClient,
): (status: SidecarStatus) => void {
	let firstApply = true
	return (status) => {
		if (status === SIDECAR_STATUS_CONNECTED) {
			overlay.repoint(buildIframeUrl())
			// Only a connect after a drop needs to skip the channel's backoff.
			if (!firstApply) channel.reconnectNow()
		} else if (status === SIDECAR_STATUS_REVIVING) {
			overlay.showPlaceholder('reviving')
		} else if (status === SIDECAR_STATUS_UNAVAILABLE) {
			overlay.showPlaceholder('unavailable')
		} else {
			overlay.showPlaceholder('connecting')
		}
		firstApply = false
	}
}

function installHostState(channel: ChannelClient): () => void {
	const sendWhenConnected = (msg: unknown): void => {
		if (!channel.isConnected()) return
		channel.send(HOST_CHANNEL, msg)
	}
	const stopTracking = installCurrentPageTracker({ send: sendWhenConnected })
	const stopNavigation = installNavigationCompleteEmitter({
		send: sendWhenConnected,
	})
	return () => {
		stopTracking()
		stopNavigation()
	}
}

async function startAssistant({ vueApp }: DmsAppContext): Promise<void> {
	const { $authFetch } = useAuthFetch()
	const controller = createSidecarStatusController(() =>
		$authFetch(SIDECAR_INFO_PATH),
	)
	// A null/disabled first probe means the assistant shouldn't appear at all —
	// preserve the previous "no icon, no overlay" behavior in that case.
	if (!(await controller.init())) return
	const overlay = injectOverlay()
	if (overlay === null) return
	installToggleShortcut({ onToggle: () => overlay.toggleOpen() })
	// Registered unconditionally (even while reviving) so the launcher is present
	// through an outage; opening it surfaces the panel's own status placeholder.
	registerLauncherAction(() => overlay.toggleFromLauncher())
	// Host-side dev hot reload: a page the agent just wrote is re-registered
	// asynchronously, so each navigation waits for the layout to serve it, one at
	// a time so a burst of commands cannot land out of order.
	const dispatchHostCommand = createHostCommandDispatcher({
		router: useDmsRouter(),
		devReload: useDmsDevReload(),
	})
	const channel = createAssistantChannel({ $authFetch, controller, dispatchHostCommand })
	controller.subscribe(statusApplier(overlay, channel))
	followPanel(overlay, channel)
	const stop = installHostState(channel)
	vueApp.onUnmount(() => {
		stop()
		channel.stop()
	})
	import.meta.hot?.dispose(stop)
}

export default defineDmsPlugin((context) => {
	if (!import.meta.env.DEV) return
	const { loggedIn } = useUserSession()
	const stopGate = runWhenLoggedIn(
		() => loggedIn.value,
		() => void context.runWithContext(() => startAssistant(context)),
	)
	context.vueApp.onUnmount(stopGate)
})
