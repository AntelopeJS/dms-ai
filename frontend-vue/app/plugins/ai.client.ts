import { defineDmsPlugin, useDmsRouter } from '#dms-inertia/frontend-module'
import {
	SIDECAR_HOST_NAME,
	SIDECAR_INFO_PATH,
	SIDECAR_PROBE_HOST,
	SIDECAR_STATUS_CONNECTED,
	SIDECAR_STATUS_REVIVING,
	SIDECAR_STATUS_UNAVAILABLE,
	WS_STATUS_CONNECTED,
	WS_STATUS_CONNECTING,
} from '../runtime/constants'
import { installCurrentPageTracker } from '../runtime/current-page'
import { registerLauncherAction } from '../runtime/header-action'
import { createHostCommandDispatcher } from '../runtime/host-commands'
import { installNavigationCompleteEmitter } from '../runtime/navigation-complete'
import { injectOverlay } from '../runtime/overlay'
import { installToggleShortcut } from '../runtime/shortcuts'
import {
	createSidecarStatusController,
	type SidecarStatus,
} from '../runtime/sidecar-status'
import { createHostWsClient } from '../runtime/ws-client'

function buildIframeUrl(port: number, token: string): string {
	// Seed the chatbox with the host's current light/dark mode so its very first
	// paint matches; the theme bridge keeps it in sync from there on.
	const mode = document.documentElement.classList.contains('dark')
		? 'dark'
		: 'light'
	return `${SIDECAR_PROBE_HOST}:${port}/?theme=${mode}#token=${encodeURIComponent(token)}`
}

export default defineDmsPlugin(async ({ vueApp }) => {
	if (!import.meta.env.DEV) return
	const { loggedIn } = useUserSession()
	if (!loggedIn.value) return
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

	const router = useDmsRouter()
	// Host-side dev hot reload. A page the agent just wrote is re-registered
	// asynchronously, so every overlay-driven navigation waits for the committed
	// site layout to serve the route before pushing it.
	const devReload = useDmsDevReload()
	// Serialized so a burst of navigate commands cannot land out of order.
	const dispatchHostCommand = createHostCommandDispatcher({ router, devReload })
	const hostWs = createHostWsClient({
		sidecarHost: SIDECAR_HOST_NAME,
		getPort: () => controller.getPort(),
		getClientToken: () => controller.getClientToken(),
		onMessage: dispatchHostCommand,
		onStatusChange: (status) => {
			// A socket drop means the sidecar likely idle-exited/crashed: ask the
			// controller to re-probe (relearning a possibly-new port) rather than let
			// the socket keep retrying the dead one.
			if (status !== WS_STATUS_CONNECTED && status !== WS_STATUS_CONNECTING) {
				controller.reportWsDown()
			}
		},
	})

	let firstApply = true
	const applyStatus = (status: SidecarStatus): void => {
		if (status === SIDECAR_STATUS_CONNECTED) {
			const port = controller.getPort()
			const token = controller.getClientToken()
			if (port !== null && token) overlay.repoint(buildIframeUrl(port, token))
			// On the first apply the socket was just created and is connecting to the
			// right port; only later connects (after a drop or port change) need a
			// forced, backoff-skipping reconnect.
			if (!firstApply) hostWs.reconnectNow()
		} else if (status === SIDECAR_STATUS_REVIVING) {
			overlay.showPlaceholder('reviving')
		} else if (status === SIDECAR_STATUS_UNAVAILABLE) {
			overlay.showPlaceholder('unavailable')
		} else {
			overlay.showPlaceholder('connecting')
		}
		firstApply = false
	}
	controller.subscribe(applyStatus)

	const sendWhenConnected = (msg: unknown): void => {
		if (!hostWs.isConnected()) return
		hostWs.send(msg)
	}
	const stopTracking = installCurrentPageTracker({ send: sendWhenConnected })
	const stopNavigation = installNavigationCompleteEmitter({
		send: sendWhenConnected,
	})
	const stop = (): void => {
		stopTracking()
		stopNavigation()
	}
	vueApp.onUnmount(stop)
	import.meta.hot?.dispose(stop)
})
