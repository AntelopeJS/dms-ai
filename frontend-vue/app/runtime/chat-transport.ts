import type { ChannelStatus } from './channel-client'
import { CHAT_TRANSPORT_KEY, LOG_PREFIX } from './constants'

/**
 * What the chat document, same-origin with the dashboard, reads on its parent
 * window to reach the sidecar: the dashboard owns the tab's only stream and
 * lends the chat its channel of it.
 */
export interface ChatTransport {
	/** Raw sidecar frames of the chat channel, in order. */
	onFrame: (listener: (raw: string) => void) => () => void
	/** Every (re)connection is a new sidecar socket: the chat says hello again. */
	onReady: (listener: () => void) => () => void
	onStatus: (listener: (status: ChannelStatus) => void) => () => void
	getStatus: () => ChannelStatus
	/** False when the message was dropped because the channel is not connected. */
	send: (msg: unknown) => boolean
	reconnect: () => void
}

export interface ChatTransportActions {
	send: (msg: unknown) => boolean
	reconnect: () => void
	getStatus: () => ChannelStatus
}

export interface ChatTransportHub {
	transport: ChatTransport
	deliverFrame: (raw: string) => void
	announceReady: () => void
	announceStatus: (status: ChannelStatus) => void
}

interface Listeners<T> {
	add: (listener: (value: T) => void) => () => void
	emit: (value: T) => void
}

/**
 * A listener belongs to a chat document that may already be gone: one failing
 * must not stop the others.
 */
function createListeners<T>(): Listeners<T> {
	const listeners = new Set<(value: T) => void>()
	return {
		add: (listener) => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		emit: (value) => {
			for (const listener of listeners) {
				try {
					listener(value)
				} catch (error: unknown) {
					console.error(`${LOG_PREFIX} chat listener failed`, error)
				}
			}
		},
	}
}

export function createChatTransport(
	actions: ChatTransportActions,
): ChatTransportHub {
	const frames = createListeners<string>()
	const ready = createListeners<undefined>()
	const statuses = createListeners<ChannelStatus>()
	return {
		transport: {
			onFrame: frames.add,
			onReady: (listener) => ready.add(() => listener()),
			onStatus: statuses.add,
			getStatus: actions.getStatus,
			send: actions.send,
			reconnect: actions.reconnect,
		},
		deliverFrame: frames.emit,
		announceReady: () => ready.emit(undefined),
		announceStatus: statuses.emit,
	}
}

/** Publishes the transport where the chat document looks for it. */
export function exposeChatTransport(transport: ChatTransport): void {
	Reflect.set(globalThis, CHAT_TRANSPORT_KEY, transport)
}
