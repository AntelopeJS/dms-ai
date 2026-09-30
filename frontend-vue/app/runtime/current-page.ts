import { router } from '@inertiajs/vue3'
import { HOST_STATE_UPDATE_TYPE } from './constants'

interface CurrentPagePayload {
	path: string
}

interface HostStateUpdateMessage {
	type: typeof HOST_STATE_UPDATE_TYPE
	currentPage: CurrentPagePayload
}

interface InstallCurrentPageTrackerOptions {
	send: (msg: HostStateUpdateMessage) => void
}

/** The state update announcing the page at `url`. */
export function buildCurrentPageUpdate(url: string): HostStateUpdateMessage {
	return {
		type: HOST_STATE_UPDATE_TYPE,
		currentPage: { path: new URL(url, window.location.origin).pathname },
	}
}

export function installCurrentPageTracker(
	options: InstallCurrentPageTrackerOptions,
): () => void {
	const pushFor = (url: string): void => options.send(buildCurrentPageUpdate(url))
	const stop = router.on('navigate', (event) => pushFor(event.detail.page.url))
	pushFor(window.location.href)
	return stop
}
