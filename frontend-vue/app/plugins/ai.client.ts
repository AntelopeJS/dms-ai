import {
	type DmsAppContext,
	defineDmsPlugin,
	useDmsRouter,
	useDmsState,
} from '#dms/frontend-module'
import { type Ref, readonly, ref, watch } from 'vue'
import {
	ASSISTANT_SESSION_KEY,
	type AssistantSession,
} from '../runtime/assistant-session'
import {
	type ChannelClient,
	createChannelClient,
} from '../runtime/channel-client'
import {
	type ChatTransportHub,
	createChatTransport,
} from '../runtime/chat-transport'
import {
	APP_OVERLAYS_STATE_KEY,
	CHANNEL_IDLE_STOP_MS,
	CHANNEL_STATUS_RECONNECTING,
	CHAT_PANEL_COMPONENT_NAME,
	HELLO_MESSAGE_TYPE,
	HOST_ROLE,
	JSON_CONTENT_TYPE,
	SIDECAR_INFO_PATH,
	SIDECAR_STATUS_CONNECTED,
} from '../runtime/constants'
import {
	buildCurrentPageUpdate,
	installCurrentPageTracker,
} from '../runtime/current-page'
import { createFrameRouter } from '../runtime/frame-router'
import { registerLauncherAction } from '../runtime/header-action'
import {
	createHostCommandDispatcher,
	type HostCommandDispatcher,
} from '../runtime/host-commands'
import { installNavigationCompleteEmitter } from '../runtime/navigation-complete'
import { type ChatPanelState, createChatPanelState } from '../runtime/panel-state'
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

interface AssistantChannel {
	client: ChannelClient
	chat: ChatTransportHub
}

/**
 * The tab's one stream to the sidecar, for the dashboard and its chat alike.
 * Every connection is a new sidecar socket, so each one says hello as the host
 * and resends the current page, which the agent would otherwise only learn at
 * the next navigation; the chat then says hello with its conversation. A drop
 * re-probes the sidecar, which revives one that idle-exited.
 */
function createAssistantChannel(deps: ChannelDeps): AssistantChannel {
	const chat = createChatTransport({
		send: (msg) => client.send(msg),
		reconnect: () => client.reconnectNow(),
		getStatus: () => client.getStatus(),
	})
	const client = createChannelClient({
		post: (path, body) =>
			deps.$authFetch(path, {
				method: 'POST',
				body: JSON.stringify(body),
				headers: { 'content-type': JSON_CONTENT_TYPE },
			}),
		onReady: () => {
			client.send({ type: HELLO_MESSAGE_TYPE, role: HOST_ROLE })
			client.send(buildCurrentPageUpdate(window.location.href))
			chat.announceReady()
		},
		onFrame: createFrameRouter({
			host: deps.dispatchHostCommand,
			chat: chat.deliver,
		}),
		onStatusChange: (status) => {
			chat.announceStatus(status)
			if (status === CHANNEL_STATUS_RECONNECTING) deps.controller.reportChannelDown()
		},
	})
	return { client, chat }
}

/**
 * The stream lives while the panel is open in a visible tab, and a little
 * after. A tab in the background holds no stream of its own: the browser's six
 * HTTP/1.1 connections to the dashboard are shared by every tab, and the DMS
 * already keeps two of them per tab.
 */
function followPanel(panel: ChatPanelState, client: ChannelClient): void {
	let stopTimer: ReturnType<typeof setTimeout> | null = null
	const follow = (): void => {
		if (stopTimer !== null) clearTimeout(stopTimer)
		stopTimer = null
		const isNeeded = panel.isOpen.value && document.visibilityState === 'visible'
		if (isNeeded) client.start()
		else stopTimer = setTimeout(() => client.stop(), CHANNEL_IDLE_STOP_MS)
	}
	watch(panel.isOpen, follow)
	document.addEventListener('visibilitychange', follow)
	follow()
}

/**
 * The sidecar's reachability, for the panel's status screen. Coming back after
 * a drop, the stream skips its backoff and reconnects at once.
 */
function followSidecarStatus(
	controller: SidecarStatusController,
	client: ChannelClient,
): Readonly<Ref<SidecarStatus>> {
	const status = ref<SidecarStatus>(controller.getStatus())
	let isFirstReport = true
	controller.subscribe((next) => {
		if (next === SIDECAR_STATUS_CONNECTED && !isFirstReport) client.reconnectNow()
		status.value = next
		isFirstReport = false
	})
	return readonly(status)
}

function installHostState(client: ChannelClient): () => void {
	const sendWhenConnected = (msg: unknown): void => {
		if (!client.isConnected()) return
		client.send(msg)
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

/** Renders the chat panel in the dashboard's persistent overlays, on every page. */
function registerChatPanel(): void {
	const overlays = useDmsState<string[]>(APP_OVERLAYS_STATE_KEY, () => [])
	if (overlays.value.includes(CHAT_PANEL_COMPONENT_NAME)) return
	overlays.value = [...overlays.value, CHAT_PANEL_COMPONENT_NAME]
}

/**
 * Starts the tab's assistant once the first probe finds a sidecar: its stream,
 * the chat panel among the dashboard's persistent overlays, the launcher and
 * the shortcut. A navigation the agent asks for waits for the dev reload to
 * serve the page it just wrote, one at a time so a burst cannot land out of
 * order.
 */
async function startAssistant({ vueApp }: DmsAppContext): Promise<void> {
	const { $authFetch } = useAuthFetch()
	const controller = createSidecarStatusController(() =>
		$authFetch(SIDECAR_INFO_PATH),
	)
	if (!(await controller.init())) return
	const router = useDmsRouter()
	const dispatchHostCommand = createHostCommandDispatcher({
		router,
		devReload: useDmsDevReload(),
	})
	const { client, chat } = createAssistantChannel({ $authFetch, controller, dispatchHostCommand })
	const panel = createChatPanelState()
	const session: AssistantSession = {
		status: followSidecarStatus(controller, client),
		chat: chat.transport,
		panel,
		navigate: (path) => void router.push(path),
	}
	vueApp.provide(ASSISTANT_SESSION_KEY, session)
	registerChatPanel()
	installToggleShortcut({ onToggle: panel.toggle })
	registerLauncherAction(panel.toggleFromLauncher)
	followPanel(panel, client)
	const stop = installHostState(client)
	vueApp.onUnmount(() => {
		stop()
		client.stop()
	})
	import.meta.hot?.dispose(stop)
}

/**
 * The assistant appears for a signed-in owner in development only: a first
 * probe that finds no dms-ai backend, or a disabled sidecar, leaves no trace.
 */
export default defineDmsPlugin((context) => {
	if (!import.meta.env.DEV) return
	const { loggedIn } = useUserSession()
	const stopGate = runWhenLoggedIn(
		() => loggedIn.value,
		() => void context.runWithContext(() => startAssistant(context)),
	)
	context.vueApp.onUnmount(stopGate)
})
