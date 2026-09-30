import { describe, expect, it, vi } from 'vitest'
import {
	createChatTransport,
	exposeChatTransport,
} from '../app/runtime/chat-transport'
import { CHAT_TRANSPORT_KEY } from '../app/runtime/constants'

function hub() {
	const actions = {
		send: vi.fn(() => true),
		reconnect: vi.fn(),
		getStatus: vi.fn(() => 'connected' as const),
	}
	return { actions, chat: createChatTransport(actions) }
}

describe('chat transport', () => {
	it('lends the chat its channel: frames, readiness and status in, messages out', () => {
		const { actions, chat } = hub()
		const frames: string[] = []
		const statuses: string[] = []
		const ready = vi.fn()
		chat.transport.onFrame((raw) => frames.push(raw))
		chat.transport.onStatus((status) => statuses.push(status))
		chat.transport.onReady(ready)
		chat.deliverFrame('{"type":"run_done"}')
		chat.announceStatus('reconnecting')
		chat.announceReady()
		expect(chat.transport.send({ type: 'hello' })).toBe(true)
		chat.transport.reconnect()
		expect(frames).toEqual(['{"type":"run_done"}'])
		expect(statuses).toEqual(['reconnecting'])
		expect(ready).toHaveBeenCalledTimes(1)
		expect(actions.send).toHaveBeenCalledWith({ type: 'hello' })
		expect(actions.reconnect).toHaveBeenCalledTimes(1)
		expect(chat.transport.getStatus()).toBe('connected')
	})

	it('stops delivering to a listener once it unsubscribed', () => {
		const { chat } = hub()
		const frames: string[] = []
		const unsubscribe = chat.transport.onFrame((raw) => frames.push(raw))
		unsubscribe()
		chat.deliverFrame('{}')
		expect(frames).toEqual([])
	})

	it('keeps delivering when one listener throws, as a gone chat document would', () => {
		const { chat } = hub()
		const frames: string[] = []
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		chat.transport.onFrame(() => {
			throw new Error('dead document')
		})
		chat.transport.onFrame((raw) => frames.push(raw))
		chat.deliverFrame('{}')
		expect(frames).toEqual(['{}'])
		error.mockRestore()
	})

	it('publishes itself where the same-origin chat document looks', () => {
		const { chat } = hub()
		exposeChatTransport(chat.transport)
		expect(Reflect.get(globalThis, CHAT_TRANSPORT_KEY)).toBe(chat.transport)
		Reflect.deleteProperty(globalThis, CHAT_TRANSPORT_KEY)
	})
})
