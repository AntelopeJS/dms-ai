import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import ChatPanel from '../app/components/ChatPanel.vue'
import {
	ASSISTANT_SESSION_KEY,
	type AssistantSession,
} from '../app/runtime/assistant-session'
import type { ChannelStatus } from '../app/runtime/channel-client'
import {
	type ChatTransportHub,
	createChatTransport,
} from '../app/runtime/chat-transport'
import { resetPrefsForTesting } from '../app/runtime/overlay-prefs'
import { createChatPanelState } from '../app/runtime/panel-state'
import type { SidecarStatus } from '../app/runtime/sidecar-status'

const CONVERSATION_ID = 'conv-native-1'
const STALL_AFTER_MS = 20_000

interface Harness {
	session: AssistantSession
	hub: ChatTransportHub
	sent: Array<Record<string, unknown>>
	reconnects: number
	sidecarStatus: ReturnType<typeof ref<SidecarStatus>>
	setChannelStatus: (status: ChannelStatus) => void
	navigate: ReturnType<typeof vi.fn>
}

function createHarness(): Harness {
	let channelStatus: ChannelStatus = 'connected'
	const harness = {
		sent: [] as Array<Record<string, unknown>>,
		reconnects: 0,
		sidecarStatus: ref<SidecarStatus>('connected'),
		navigate: vi.fn(),
	} as Harness
	harness.hub = createChatTransport({
		send: (msg) => {
			if (channelStatus !== 'connected') return false
			harness.sent.push(msg as Record<string, unknown>)
			return true
		},
		reconnect: () => {
			harness.reconnects += 1
		},
		getStatus: () => channelStatus,
	})
	harness.setChannelStatus = (status) => {
		channelStatus = status
		harness.hub.announceStatus(status)
	}
	harness.session = {
		status: harness.sidecarStatus,
		chat: harness.hub.transport,
		panel: createChatPanelState(),
		navigate: harness.navigate,
	}
	return harness
}

let wrapper: VueWrapper | null = null

function mountPanel(harness: Harness): VueWrapper {
	wrapper = mount(ChatPanel, {
		attachTo: document.body,
		global: {
			provide: { [ASSISTANT_SESSION_KEY as symbol]: harness.session },
			stubs: { UIcon: true, USelect: true },
		},
	})
	return wrapper
}

async function openPanel(harness: Harness): Promise<VueWrapper> {
	const mounted = mountPanel(harness)
	harness.session.panel.toggle()
	await nextTick()
	await flushPromises()
	return mounted
}

function deliver(harness: Harness, event: Record<string, unknown>): void {
	harness.hub.deliver({ conversationId: CONVERSATION_ID, ...event })
}

async function sendMessage(panel: VueWrapper, text: string): Promise<void> {
	await panel.find('textarea').setValue(text)
	await panel.find('form.composer').trigger('submit')
}

function sentOfType(harness: Harness, type: string) {
	return harness.sent.filter((msg) => msg.type === type)
}

beforeEach(() => {
	localStorage.setItem('dms-ai-conversation-id', CONVERSATION_ID)
})

afterEach(() => {
	wrapper?.unmount()
	wrapper = null
	resetPrefsForTesting()
	localStorage.clear()
	vi.useRealTimers()
})

describe('the chat as a component of the dashboard', () => {
	it('renders in the dashboard document itself: no iframe, no second document', async () => {
		const harness = createHarness()
		const panel = await openPanel(harness)
		expect(document.querySelector('iframe')).toBeNull()
		expect(document.getElementById('dms-ai-overlay-root')).not.toBeNull()
		expect(panel.find('.chatbox').exists()).toBe(true)
		expect(Reflect.has(globalThis, 'dmsAiChatTransport')).toBe(false)
	})

	it('says hello with its conversation on the shared stream when it opens', async () => {
		const harness = createHarness()
		await openPanel(harness)
		expect(sentOfType(harness, 'hello')).toEqual([
			{ type: 'hello', role: 'iframe', conversationId: CONVERSATION_ID },
		])
	})

	it('keeps its conversation when the panel is closed and opened again', async () => {
		const harness = createHarness()
		const panel = await openPanel(harness)
		await sendMessage(panel, 'build me a page')
		harness.session.panel.close()
		await nextTick()
		harness.session.panel.toggle()
		await nextTick()
		expect(panel.text()).toContain('build me a page')
	})

	it('opens the settings page through the dashboard router, not the sidecar', async () => {
		const harness = createHarness()
		const panel = await openPanel(harness)
		await panel.find('button[aria-label="Settings"]').trigger('click')
		expect(harness.navigate).toHaveBeenCalledExactlyOnceWith(
			'/modules/ai/settings',
		)
		expect(sentOfType(harness, 'request_host_navigate')).toEqual([])
	})

	it('closes from its own button, and on a click elsewhere in the dashboard', async () => {
		const harness = createHarness()
		const panel = await openPanel(harness)
		panel.find('.chatbox').element.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, composed: true }),
		)
		expect(harness.session.panel.isOpen.value).toBe(true)
		document.body.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, composed: true }),
		)
		expect(harness.session.panel.isOpen.value).toBe(false)
		harness.session.panel.toggle()
		await nextTick()
		await panel.find('button[aria-label="Close"]').trigger('click')
		expect(harness.session.panel.isOpen.value).toBe(false)
	})

	it('stays open on a click in what the dashboard portals out of the app', async () => {
		const harness = createHarness()
		await openPanel(harness)
		const overlays = document.createElement('div')
		overlays.id = 'dms-overlays'
		const toast = document.createElement('button')
		overlays.append(toast)
		document.body.append(overlays)
		toast.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, composed: true }),
		)
		expect(harness.session.panel.isOpen.value).toBe(true)
		overlays.remove()
	})

	it('covers the chat with the sidecar status while it is not reachable, and can still be closed', async () => {
		const harness = createHarness()
		const panel = await openPanel(harness)
		harness.sidecarStatus.value = 'reviving'
		await nextTick()
		expect(panel.find('.dms-ai-panel-status').text()).toContain(
			'Reconnecting the assistant',
		)
		harness.sidecarStatus.value = 'unavailable'
		await nextTick()
		expect(panel.find('.dms-ai-panel-status').text()).toContain(
			'Assistant unavailable',
		)
		await panel.find('.dms-ai-panel-status button').trigger('click')
		expect(harness.session.panel.isOpen.value).toBe(false)
		harness.sidecarStatus.value = 'connected'
		await nextTick()
		expect(panel.find('.dms-ai-panel-status').exists()).toBe(false)
	})

	it('renders the answer as markup, with nothing the model wrote running in the dashboard', async () => {
		vi.useFakeTimers()
		const harness = createHarness()
		const panel = await openPanel(harness)
		await sendMessage(panel, 'go')
		deliver(harness, {
			type: 'assistant_message_chunk',
			text: '**Done** <img src=x onerror="window.pwned=1"> [x](javascript:alert(1))',
		})
		await vi.advanceTimersByTimeAsync(100)
		deliver(harness, { type: 'run_done' })
		await nextTick()
		const answer = panel.find('.chat-markdown')
		expect(answer.find('strong').text()).toBe('Done')
		expect(answer.find('img').exists()).toBe(false)
		expect(answer.find('a').exists()).toBe(false)
		expect(Reflect.get(globalThis, 'pwned')).toBeUndefined()
	})
})

describe('a running turn shows what it is doing, and never spins forever', () => {
	it('shows the activity the sidecar reports, with the elapsed time', async () => {
		const harness = createHarness()
		const panel = await openPanel(harness)
		await sendMessage(panel, 'reproduce this page')
		deliver(harness, {
			type: 'run_progress',
			activity: 'writing',
			detail: 'Write',
			elapsedMs: 72_000,
			idleMs: 0,
		})
		await nextTick()
		expect(panel.find('.thinking').text()).toContain('Preparing · Write file…')
		expect(panel.find('.thinking-clock').text()).toBe('1:12')
	})

	it('says so after 20 s without news about the turn, and reconnects or stops from there', async () => {
		vi.useFakeTimers()
		const harness = createHarness()
		const panel = await openPanel(harness)
		await sendMessage(panel, 'reproduce this page')
		await vi.advanceTimersByTimeAsync(STALL_AFTER_MS + 1_000)
		const notice = panel.find('.run-stalled')
		expect(notice.text()).toContain('No news from the assistant for 0:2')
		const [reconnect, stop] = notice.findAll('button')
		await reconnect?.trigger('click')
		expect(harness.reconnects).toBe(1)
		await stop?.trigger('click')
		expect(sentOfType(harness, 'interrupt_turn')).toHaveLength(1)
	})

	it('stays quiet while the sidecar keeps reporting a long step', async () => {
		vi.useFakeTimers()
		const harness = createHarness()
		const panel = await openPanel(harness)
		await sendMessage(panel, 'reproduce this page')
		for (let beat = 0; beat < 8; beat += 1) {
			await vi.advanceTimersByTimeAsync(5_000)
			deliver(harness, {
				type: 'run_progress',
				activity: 'tool',
				detail: 'Write',
				elapsedMs: (beat + 1) * 5_000,
				idleMs: 0,
			})
		}
		await nextTick()
		expect(panel.find('.run-stalled').exists()).toBe(false)
		expect(panel.find('.thinking').exists()).toBe(true)
	})

	it('shows a run error with Retry, which sends the message again', async () => {
		const harness = createHarness()
		const panel = await openPanel(harness)
		await sendMessage(panel, 'reproduce this page')
		deliver(harness, { type: 'run_error', error: 'API Error: 529 overloaded' })
		await nextTick()
		const error = panel.find('.message-bubble-error')
		expect(error.text()).toContain('API Error: 529 overloaded')
		await error.find('button').trigger('click')
		expect(sentOfType(harness, 'user_message')).toHaveLength(2)
	})

	it('offers no Retry for a run error that sending again cannot fix', async () => {
		const harness = createHarness()
		const panel = await openPanel(harness)
		await sendMessage(panel, 'reproduce this page')
		deliver(harness, {
			type: 'run_error',
			error: 'Prompt is too long',
			isRetryable: false,
		})
		await nextTick()
		const error = panel.find('.message-bubble-error')
		expect(error.text()).toContain('Prompt is too long')
		expect(error.find('button').exists()).toBe(false)
	})

	it('says a message was not sent when the stream dropped as it left', async () => {
		const harness = createHarness()
		const panel = await openPanel(harness)
		await panel.find('textarea').setValue('reproduce this page')
		harness.setChannelStatus('reconnecting')
		await panel.find('form.composer').trigger('submit')
		expect(panel.find('.message-bubble-error').text()).toContain(
			'Your message was not sent',
		)
		expect(sentOfType(harness, 'user_message')).toEqual([])
	})

	it('shows the error a run left in the stored transcript after a reload', async () => {
		const harness = createHarness()
		const panel = await openPanel(harness)
		deliver(harness, {
			type: 'conversation_snapshot',
			messages: [
				{ role: 'user', content: 'go', timestampMs: 1 },
				{ role: 'error', content: 'The run was stopped.', timestampMs: 2 },
			],
		})
		await nextTick()
		expect(panel.find('.message-bubble-error').text()).toContain(
			'The run was stopped.',
		)
	})
})

describe('the shared stream going away and coming back', () => {
	it('says reconnecting and holds the input, then says hello again and picks the transcript up, as after a dms-ai hot reload', async () => {
		const harness = createHarness()
		const panel = await openPanel(harness)
		harness.setChannelStatus('reconnecting')
		await nextTick()
		expect(panel.find('.connection-banner').text()).toContain('Reconnecting')
		expect(panel.find('textarea').attributes('disabled')).toBeDefined()
		harness.setChannelStatus('connected')
		harness.hub.announceReady()
		deliver(harness, {
			type: 'conversation_snapshot',
			messages: [{ role: 'user', content: 'before the reload', timestampMs: 1 }],
		})
		deliver(harness, { type: 'run_resumed' })
		await nextTick()
		expect(sentOfType(harness, 'hello')).toHaveLength(2)
		expect(panel.find('.connection-banner').exists()).toBe(false)
		expect(panel.find('textarea').attributes('disabled')).toBeUndefined()
		expect(panel.text()).toContain('before the reload')
		expect(panel.find('.thinking').exists()).toBe(true)
	})
})
