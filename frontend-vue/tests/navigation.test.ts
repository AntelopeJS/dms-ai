import { describe, expect, it, vi } from 'vitest'
import { installCurrentPageTracker } from '../app/runtime/current-page'
import { installNavigationCompleteEmitter } from '../app/runtime/navigation-complete'

function navigate(url: string): void {
	document.dispatchEvent(
		new CustomEvent('inertia:navigate', {
			detail: { page: { url } },
		}),
	)
}

describe('Inertia host navigation', () => {
	it('reports the initial pathname and completed visits, then unsubscribes', () => {
		window.history.replaceState({}, '', '/initial?tab=one#section')
		const send = vi.fn()
		const stop = installCurrentPageTracker({ send })
		expect(send).toHaveBeenLastCalledWith({
			type: 'host_state_update',
			currentPage: { path: '/initial' },
		})
		navigate('/other/deep?tab=two#anchor')
		expect(send).toHaveBeenLastCalledWith({
			type: 'host_state_update',
			currentPage: { path: '/other/deep' },
		})
		stop()
		navigate('/ignored')
		expect(send).toHaveBeenCalledTimes(2)
	})

	it('emits completion only after navigation and removes its event listener', () => {
		const send = vi.fn()
		const stop = installNavigationCompleteEmitter({ send })
		expect(send).not.toHaveBeenCalled()
		navigate('https://example.test/finished?view=graph#node')
		expect(send).toHaveBeenCalledExactlyOnceWith({
			type: 'host_navigation_complete',
			path: '/finished',
		})
		stop()
		navigate('/ignored')
		expect(send).toHaveBeenCalledTimes(1)
	})
})
