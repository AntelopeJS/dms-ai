import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { runWhenLoggedIn } from '../app/runtime/session-gate'

describe('session gate', () => {
	it('starts immediately when the session is already hydrated', () => {
		const start = vi.fn()
		runWhenLoggedIn(() => true, start)
		expect(start).toHaveBeenCalledTimes(1)
	})

	it('starts once the session appears, and only once', async () => {
		const loggedIn = ref(false)
		const start = vi.fn()
		runWhenLoggedIn(() => loggedIn.value, start)
		expect(start).not.toHaveBeenCalled()

		loggedIn.value = true
		await nextTick()
		expect(start).toHaveBeenCalledTimes(1)

		loggedIn.value = false
		await nextTick()
		loggedIn.value = true
		await nextTick()
		expect(start).toHaveBeenCalledTimes(1)
	})

	it('never starts once the gate is stopped', async () => {
		const loggedIn = ref(false)
		const start = vi.fn()
		const stop = runWhenLoggedIn(() => loggedIn.value, start)

		stop()
		loggedIn.value = true
		await nextTick()
		expect(start).not.toHaveBeenCalled()
	})
})
