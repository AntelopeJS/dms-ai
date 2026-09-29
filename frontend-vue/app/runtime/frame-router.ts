import { HOST_COMMAND_TYPES } from './constants'

export interface TypedMessage {
	type: string
}

export interface FrameRoutes {
	host: (msg: TypedMessage) => void
	chat: (msg: TypedMessage) => void
}

function isTypedMessage(value: unknown): value is TypedMessage {
	if (value === null || typeof value !== 'object') return false
	return typeof Reflect.get(value, 'type') === 'string'
}

function parseFrame(raw: string): TypedMessage | null {
	try {
		const parsed: unknown = JSON.parse(raw)
		return isTypedMessage(parsed) ? parsed : null
	} catch {
		return null
	}
}

/**
 * The dashboard and its chat share the tab's one sidecar socket: each frame is
 * parsed once, then handed to the dashboard when it is a host command and to
 * the chat otherwise. A frame that is not a typed message reaches neither.
 */
export function createFrameRouter(routes: FrameRoutes): (raw: string) => void {
	return (raw) => {
		const msg = parseFrame(raw)
		if (msg === null) return
		const route = HOST_COMMAND_TYPES.has(msg.type) ? routes.host : routes.chat
		route(msg)
	}
}
