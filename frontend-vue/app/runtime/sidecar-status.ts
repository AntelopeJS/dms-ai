import { createBackoff, nextDelay, resetBackoff } from './backoff'
import {
	SIDECAR_POLL_DELAYS_MS,
	SIDECAR_STATUS_CONNECTED,
	SIDECAR_STATUS_CONNECTING,
	SIDECAR_STATUS_REVIVING,
	SIDECAR_STATUS_UNAVAILABLE,
} from './constants'

export type SidecarStatus =
	| typeof SIDECAR_STATUS_CONNECTING
	| typeof SIDECAR_STATUS_CONNECTED
	| typeof SIDECAR_STATUS_REVIVING
	| typeof SIDECAR_STATUS_UNAVAILABLE

interface SidecarInfo {
	port: number | null
	clientToken: string | null
	isRunning: boolean
	hasGivenUp: boolean
	disabled: boolean
}

export interface SidecarStatusController {
	// Runs the first probe. Returns false when the assistant should not be shown
	// at all — the dms-ai backend route is absent (probe unreachable) or spawning
	// is disabled for this process — so the caller skips injection entirely.
	init: () => Promise<boolean>
	getStatus: () => SidecarStatus
	getPort: () => number | null
	getClientToken: () => string | null
	// Subscribe to status changes; fires immediately with the current status so a
	// late subscriber (overlay/icon injected after init) reflects it right away.
	subscribe: (cb: (status: SidecarStatus) => void) => () => void
	// The host WebSocket dropped: re-probe now to relearn a possibly-new port
	// rather than let the socket keep retrying the dead one.
	reportWsDown: () => void
	dispose: () => void
}

export type FetchSidecarInfo = () => Promise<Partial<SidecarInfo>>

async function fetchInfo(
	fetchDetails: FetchSidecarInfo,
): Promise<SidecarInfo | null> {
	try {
		const body = await fetchDetails()
		return {
			port: typeof body.port === 'number' ? body.port : null,
			clientToken:
				typeof body.clientToken === 'string' ? body.clientToken : null,
			isRunning: body.isRunning === true,
			hasGivenUp: body.hasGivenUp === true,
			disabled: body.disabled === true,
		}
	} catch {
		return null
	}
}

export function createSidecarStatusController(
	fetchDetails: FetchSidecarInfo,
): SidecarStatusController {
	const backoff = createBackoff()
	const subscribers = new Set<(status: SidecarStatus) => void>()
	let status: SidecarStatus = SIDECAR_STATUS_CONNECTING
	let port: number | null = null
	let clientToken: string | null = null
	let pollTimer: ReturnType<typeof setTimeout> | null = null
	let disposed = false

	function notify(): void {
		for (const cb of subscribers) cb(status)
	}

	function setStatus(next: SidecarStatus): void {
		if (status === next) return
		status = next
		notify()
	}

	function schedulePoll(): void {
		if (disposed || pollTimer !== null) return
		const delay = nextDelay(backoff, SIDECAR_POLL_DELAYS_MS)
		pollTimer = setTimeout(() => {
			pollTimer = null
			void poll()
		}, delay)
	}

	async function poll(): Promise<void> {
		if (disposed) return
		handleInfo(await fetchInfo(fetchDetails))
	}

	function handleInfo(info: SidecarInfo | null): void {
		if (disposed) return
		// Probe itself failed (backend momentarily unreachable): keep waiting.
		if (info === null) {
			setStatus(SIDECAR_STATUS_REVIVING)
			schedulePoll()
			return
		}
		if (info.hasGivenUp) {
			setStatus(SIDECAR_STATUS_UNAVAILABLE)
			return
		}
		if (info.isRunning && info.port !== null && info.clientToken) {
			port = info.port
			clientToken = info.clientToken
			resetBackoff(backoff)
			// A reviving→connected transition notifies via setStatus; a port change
			// while already connected leaves the status word unchanged, so force a
			// notify there too to drive the overlay/WS onto the new port.
			if (status === SIDECAR_STATUS_CONNECTED) notify()
			else setStatus(SIDECAR_STATUS_CONNECTED)
			return
		}
		// Down but not terminal — the probe already asked the backend to respawn;
		// keep polling until it reports a port.
		setStatus(SIDECAR_STATUS_REVIVING)
		schedulePoll()
	}

	return {
		init: async (): Promise<boolean> => {
			const info = await fetchInfo(fetchDetails)
			if (info === null) return false
			if (info.disabled) return false
			handleInfo(info)
			return true
		},
		getStatus: () => status,
		getPort: () => port,
		getClientToken: () => clientToken,
		subscribe: (cb) => {
			subscribers.add(cb)
			cb(status)
			return () => {
				subscribers.delete(cb)
			}
		},
		reportWsDown: () => {
			if (disposed) return
			if (status !== SIDECAR_STATUS_CONNECTED) return
			// Surface the drop right away (amber dot + spinner) instead of waiting on
			// the re-probe: that probe awaits a respawn and can take a second or two,
			// during which the icon would otherwise look healthy. poll() flips back
			// to connected once the new port is live.
			resetBackoff(backoff)
			setStatus(SIDECAR_STATUS_REVIVING)
			void poll()
		},
		dispose: () => {
			disposed = true
			if (pollTimer !== null) {
				clearTimeout(pollTimer)
				pollTimer = null
			}
			subscribers.clear()
		},
	}
}
