import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSidecarStatusController } from '../app/runtime/sidecar-status'
import { createHostWsClient } from '../app/runtime/ws-client'

class FakeWebSocket extends EventTarget {
	static OPEN = 1
	readyState = 0
	send = vi.fn()
	close = vi.fn()
	constructor(
		public url: string,
		public protocols?: string | string[],
	) {
		super()
		sockets.push(this)
	}
}

const sockets: FakeWebSocket[] = []
afterEach(() => {
	sockets.length = 0
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('sidecar client credential lifecycle', () => {
	it('requires an authenticated bootstrap result and relearns credentials after restart', async () => {
		const fetchInfo = vi
			.fn()
			.mockResolvedValueOnce({
				port: 41001,
				clientToken: 'first',
				isRunning: true,
			})
			.mockResolvedValueOnce({
				port: 41002,
				clientToken: 'second',
				isRunning: true,
			})
		const controller = createSidecarStatusController(fetchInfo)
		expect(await controller.init()).toBe(true)
		expect(controller.getClientToken()).toBe('first')
		controller.reportWsDown()
		await vi.waitFor(() => expect(controller.getClientToken()).toBe('second'))
		expect(controller.getPort()).toBe(41002)
		controller.dispose()
	})

	it('does not report a legacy unauthenticated sidecar as connected', async () => {
		const controller = createSidecarStatusController(async () => ({
			port: 41001,
			isRunning: true,
		}))
		await controller.init()
		expect(controller.getStatus()).not.toBe('connected')
		expect(controller.getClientToken()).toBeNull()
		controller.dispose()
	})

	it('sends the credential only as a WS subprotocol and updates it on reconnect', () => {
		vi.stubGlobal('WebSocket', FakeWebSocket)
		let token: string | null = 'first'
		const client = createHostWsClient({
			sidecarHost: 'localhost',
			getPort: () => 41001,
			getClientToken: () => token,
		})
		expect(sockets[0]?.protocols).toBe('dms-ai.first')
		expect(sockets[0]?.url).toBe('ws://localhost:41001/ws/host')
		sockets[0]?.dispatchEvent(new Event('close'))
		token = 'second'
		client.reconnectNow()
		expect(sockets[1]?.protocols).toBe('dms-ai.second')
		client.close()
	})

	it('does not open a socket before a credential is available', () => {
		vi.stubGlobal('WebSocket', FakeWebSocket)
		const client = createHostWsClient({
			sidecarHost: 'localhost',
			getPort: () => 41001,
			getClientToken: () => null,
		})
		expect(sockets).toHaveLength(0)
		client.close()
	})
})
