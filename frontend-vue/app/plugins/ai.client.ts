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
	VISIBILITY_CHANGE_EVENT,
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

function followPanel(panel: ChatPanelState, client: ChannelClient): () => void {
	let stopTimer: ReturnType<typeof setTimeout> | null = null
	const clearStopTimer = (): void => {
		if (stopTimer !== null) clearTimeout(stopTimer)
		stopTimer = null
	}
	const follow = (): void => {
		clearStopTimer()
		const isNeeded = panel.isOpen.value && document.visibilityState === 'visible'
		if (isNeeded) client.start()
		else stopTimer = setTimeout(() => client.stop(), CHANNEL_IDLE_STOP_MS)
	}
	const stopWatchingPanel = watch(panel.isOpen, follow)
	document.addEventListener(VISIBILITY_CHANGE_EVENT, follow)
	follow()
	return () => {
		clearStopTimer()
		stopWatchingPanel()
		document.removeEventListener(VISIBILITY_CHANGE_EVENT, follow)
	}
}

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

function registerChatPanel(): void {
	const overlays = useDmsState<string[]>(APP_OVERLAYS_STATE_KEY, () => [])
	if (overlays.value.includes(CHAT_PANEL_COMPONENT_NAME)) return
	overlays.value = [...overlays.value, CHAT_PANEL_COMPONENT_NAME]
}

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
	const stopFollowing = followPanel(panel, client)
	const stopHostState = installHostState(client)
	const teardown = (): void => {
		stopFollowing()
		stopHostState()
		client.stop()
	}
	vueApp.onUnmount(teardown)
	import.meta.hot?.dispose(teardown)
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
