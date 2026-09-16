import { createBackoff, nextDelay, resetBackoff } from './backoff'
import {
	HELLO_MESSAGE_TYPE,
	HOST_ROLE,
	LOG_PREFIX,
	PAGE_PROTOCOL_SECURE,
	WS_HOST_PATH,
	WS_PROTOCOL_INSECURE,
	WS_PROTOCOL_SECURE,
	WS_RECONNECT_DELAYS_MS,
	WS_STATUS_CONNECTED,
	WS_STATUS_CONNECTING,
	WS_STATUS_DISCONNECTED,
	WS_STATUS_RECONNECTING,
} from './constants'

export type ConnectionStatus =
	| typeof WS_STATUS_CONNECTING
	| typeof WS_STATUS_CONNECTED
	| typeof WS_STATUS_DISCONNECTED
	| typeof WS_STATUS_RECONNECTING

interface CreateHostWsClientOptions {
	sidecarHost: string
	// The sidecar's port is read fresh on every (re)connect: an idle-exit + respawn
	// lands on a new random port, so a fixed port could never reconnect. Returns
	// null while no port is known yet, in which case connecting is deferred.
	getPort: () => number | null
	getClientToken: () => string | null
	onMessage?: (raw: unknown) => void
	onStatusChange?: (status: ConnectionStatus) => void
}

interface HostWsClient {
	close: () => void
	isConnected: () => boolean
	send: (msg: unknown) => void
	getStatus: () => ConnectionStatus
	// Drop any pending backoff and reconnect immediately against the current port.
	// Called when the status controller has relearned a fresh port.
	reconnectNow: () => void
}

export function buildWsUrl(host: string, port: number): string {
	const isSecure = window.location.protocol === PAGE_PROTOCOL_SECURE
	const scheme = isSecure ? WS_PROTOCOL_SECURE : WS_PROTOCOL_INSECURE
	return `${scheme}//${host}:${port}${WS_HOST_PATH}`
}

interface ConnectHandlers {
	onOpen: (socket: WebSocket) => void
	onClose: () => void
	onError: (event: Event) => void
	onMessage: (raw: unknown) => void
}

export function connect(
	url: string,
	handlers: ConnectHandlers,
	token: string,
): WebSocket {
	const socket = new WebSocket(url, `dms-ai.${token}`)
	socket.addEventListener('open', () => handlers.onOpen(socket))
	socket.addEventListener('close', () => handlers.onClose())
	socket.addEventListener('error', (event) => handlers.onError(event))
	socket.addEventListener('message', (event) => handlers.onMessage(event.data))
	return socket
}

function sendHello(socket: WebSocket): void {
	const payload = { type: HELLO_MESSAGE_TYPE, role: HOST_ROLE }
	socket.send(JSON.stringify(payload))
}

function logError(event: Event): void {
	console.error(`${LOG_PREFIX} ws error`, event)
}

function buildOnMessage(
	options: CreateHostWsClientOptions,
): (raw: unknown) => void {
	const handler = options.onMessage
	if (handler === undefined) return () => {}
	return handler
}

interface StatusController {
	get: () => ConnectionStatus
	set: (next: ConnectionStatus) => void
}

function createStatusController(
	notify: (status: ConnectionStatus) => void,
): StatusController {
	let current: ConnectionStatus = WS_STATUS_CONNECTING
	return {
		get: () => current,
		set: (next) => {
			if (current === next) return
			current = next
			notify(next)
		},
	}
}

function buildStatusNotifier(
	options: CreateHostWsClientOptions,
): (status: ConnectionStatus) => void {
	const handler = options.onStatusChange
	if (handler === undefined) return () => {}
	return handler
}

export function createHostWsClient(
	options: CreateHostWsClientOptions,
): HostWsClient {
	const onMessage = buildOnMessage(options)
	const status = createStatusController(buildStatusNotifier(options))
	const backoff = createBackoff()
	let socket: WebSocket | null = null
	let retryTimer: ReturnType<typeof setTimeout> | null = null
	let isIntentionallyClosed = false
	const open = () => {
		if (isIntentionallyClosed) return
		const port = options.getPort()
		const token = options.getClientToken()
		// No port yet (sidecar reviving): stay in reconnecting and wait — the
		// controller calls reconnectNow() once it relearns one.
		if (port === null || !token) {
			status.set(WS_STATUS_RECONNECTING)
			scheduleRetry()
			return
		}
		socket = connect(
			buildWsUrl(options.sidecarHost, port),
			{
				onOpen: (s) => {
					resetBackoff(backoff)
					status.set(WS_STATUS_CONNECTED)
					sendHello(s)
				},
				onClose: () => handleClose(),
				onError: logError,
				onMessage,
			},
			token,
		)
	}
	const scheduleRetry = () => {
		if (retryTimer !== null) return
		const delay = nextDelay(backoff, WS_RECONNECT_DELAYS_MS)
		retryTimer = setTimeout(() => {
			retryTimer = null
			open()
		}, delay)
	}
	const handleClose = () => {
		socket = null
		if (isIntentionallyClosed) {
			status.set(WS_STATUS_DISCONNECTED)
			return
		}
		status.set(WS_STATUS_RECONNECTING)
		scheduleRetry()
	}
	status.set(WS_STATUS_CONNECTING)
	open()
	return {
		close: () => {
			isIntentionallyClosed = true
			if (retryTimer !== null) {
				clearTimeout(retryTimer)
				retryTimer = null
			}
			socket?.close()
		},
		isConnected: () => socket?.readyState === WebSocket.OPEN,
		send: (msg: unknown) => socket?.send(JSON.stringify(msg)),
		getStatus: () => status.get(),
		reconnectNow: () => {
			if (isIntentionallyClosed) return
			if (retryTimer !== null) {
				clearTimeout(retryTimer)
				retryTimer = null
			}
			resetBackoff(backoff)
			// A live socket on the old port is stale after a port change; drop it and
			// reopen. If it was already open on the right port, onClose reopens too.
			if (socket !== null) {
				socket.close()
				return
			}
			open()
		},
	}
}
