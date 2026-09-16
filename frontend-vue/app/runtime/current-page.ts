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

export function installCurrentPageTracker(
	options: InstallCurrentPageTrackerOptions,
): () => void {
	const pushFor = (url: string): void =>
		options.send({
			type: HOST_STATE_UPDATE_TYPE,
			currentPage: { path: new URL(url, window.location.origin).pathname },
		})
	const stop = router.on('navigate', (event) => pushFor(event.detail.page.url))
	pushFor(window.location.href)
	return stop
}
