import { describe, expect, it, vi } from 'vitest'
import {
	createHostCommandDispatcher,
	type DevReloadWaiter,
} from '../app/runtime/host-commands'

function navigateCommand(path: string): string {
	return JSON.stringify({ type: 'host_command_navigate', path })
}

interface ControlledWaiter {
	waiter: DevReloadWaiter
	calls: string[]
	release: (path: string, served?: boolean) => void
	reject: (path: string, err: Error) => void
}

function controlledWaiter(): ControlledWaiter {
	const calls: string[] = []
	const settlers = new Map<
		string,
		{ resolve: (served: boolean) => void; reject: (err: Error) => void }
	>()
	return {
		calls,
		release: (path, served = true) => settlers.get(path)?.resolve(served),
		reject: (path, err) => settlers.get(path)?.reject(err),
		waiter: {
			awaitRoute: (path) => {
				calls.push(path)
				return new Promise<boolean>((resolve, reject) => {
					settlers.set(path, { resolve, reject })
				})
			},
		},
	}
}

describe('host command dispatch', () => {
	it('navigates only once the dev reload serves the target route', async () => {
		const push = vi.fn()
		const { waiter, calls, release } = controlledWaiter()
		const dispatch = createHostCommandDispatcher({
			router: { push },
			devReload: waiter,
		})
		dispatch(navigateCommand('/new-page'))
		await vi.waitFor(() => expect(calls).toEqual(['/new-page']))
		expect(push).not.toHaveBeenCalled()
		release('/new-page')
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith('/new-page'),
		)
	})

	it('navigates anyway when the route never comes back', async () => {
		const push = vi.fn()
		const dispatch = createHostCommandDispatcher({
			router: { push },
			devReload: { awaitRoute: async () => false },
		})
		dispatch(navigateCommand('/deleted'))
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith('/deleted'),
		)
	})

	it('navigates anyway when the dev reload wait rejects', async () => {
		const push = vi.fn()
		const error = new Error('dev reload exploded')
		const { waiter, calls, reject } = controlledWaiter()
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
		const dispatch = createHostCommandDispatcher({
			router: { push },
			devReload: waiter,
		})
		dispatch(navigateCommand('/broken-wait'))
		await vi.waitFor(() => expect(calls).toEqual(['/broken-wait']))
		reject('/broken-wait', error)
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith('/broken-wait'),
		)
		expect(logged).toHaveBeenCalledWith(
			expect.stringContaining('/broken-wait'),
			error,
		)
		logged.mockRestore()
	})

	it('collapses a burst into a single trip to the newest path', async () => {
		const push = vi.fn()
		const { waiter, calls, release } = controlledWaiter()
		const dispatch = createHostCommandDispatcher({
			router: { push },
			devReload: waiter,
		})
		dispatch(navigateCommand('/stale'))
		dispatch(navigateCommand('/fresh'))
		await vi.waitFor(() => expect(calls).toEqual(['/fresh']))
		release('/fresh')
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledExactlyOnceWith('/fresh'),
		)
	})

	it('keeps navigations in order when one arrives mid-wait', async () => {
		const push = vi.fn()
		const { waiter, calls, release } = controlledWaiter()
		const dispatch = createHostCommandDispatcher({
			router: { push },
			devReload: waiter,
		})
		dispatch(navigateCommand('/first'))
		await vi.waitFor(() => expect(calls).toEqual(['/first']))
		dispatch(navigateCommand('/second'))
		// The second command must not overtake the first while it is still waiting.
		expect(calls).toEqual(['/first'])
		release('/first')
		await vi.waitFor(() => expect(calls).toEqual(['/first', '/second']))
		expect(push.mock.calls.flat()).toEqual(['/first'])
		release('/second')
		await vi.waitFor(() =>
			expect(push.mock.calls.flat()).toEqual(['/first', '/second']),
		)
	})

	it('ignores malformed payloads and unknown command types', async () => {
		const push = vi.fn()
		const awaitRoute = vi.fn(async () => true)
		const dispatch = createHostCommandDispatcher({
			router: { push },
			devReload: { awaitRoute },
		})
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		dispatch('not json')
		dispatch(JSON.stringify({ type: 'host_command_unknown' }))
		expect(push).not.toHaveBeenCalled()
		expect(awaitRoute).not.toHaveBeenCalled()
		expect(warn).toHaveBeenCalledOnce()
		warn.mockRestore()
	})
})
