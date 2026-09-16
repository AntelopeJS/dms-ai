import { describe, expect, it } from 'vitest'
import {
	createBackoff,
	nextDelay,
	resetBackoff,
} from '../app/runtime/backoff'
import { WS_RECONNECT_DELAYS_MS } from '../app/runtime/constants'

describe('backoff helper', () => {
	it('returns each schedule entry in order then caps at the last value', () => {
		const state = createBackoff()
		const observed: number[] = []
		for (let i = 0; i < WS_RECONNECT_DELAYS_MS.length + 3; i += 1) {
			observed.push(nextDelay(state, WS_RECONNECT_DELAYS_MS))
		}
		const expected = [
			...WS_RECONNECT_DELAYS_MS,
			WS_RECONNECT_DELAYS_MS[WS_RECONNECT_DELAYS_MS.length - 1],
			WS_RECONNECT_DELAYS_MS[WS_RECONNECT_DELAYS_MS.length - 1],
			WS_RECONNECT_DELAYS_MS[WS_RECONNECT_DELAYS_MS.length - 1],
		]
		expect(observed).toEqual(expected)
	})

	it('resetBackoff returns the schedule to schedule[0]', () => {
		const state = createBackoff()
		nextDelay(state, WS_RECONNECT_DELAYS_MS)
		nextDelay(state, WS_RECONNECT_DELAYS_MS)
		resetBackoff(state)
		expect(nextDelay(state, WS_RECONNECT_DELAYS_MS)).toBe(
			WS_RECONNECT_DELAYS_MS[0],
		)
	})

	it('uses the configured 30s ceiling on the last delay', () => {
		const state = createBackoff()
		const lastIndex = WS_RECONNECT_DELAYS_MS.length - 1
		for (let i = 0; i < lastIndex; i += 1) {
			nextDelay(state, WS_RECONNECT_DELAYS_MS)
		}
		expect(nextDelay(state, WS_RECONNECT_DELAYS_MS)).toBe(30_000)
		expect(nextDelay(state, WS_RECONNECT_DELAYS_MS)).toBe(30_000)
	})
})
