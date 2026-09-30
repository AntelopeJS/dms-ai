import { describe, expect, it, vi } from 'vitest'
import { createSidecarStatusController } from '../app/runtime/sidecar-status'

describe('sidecar status', () => {
	it('reports connected from the status alone, and keeps no port or credential', async () => {
		const controller = createSidecarStatusController(async () => ({
			isRunning: true,
		}))
		expect(await controller.init()).toBe(true)
		expect(controller.getStatus()).toBe('connected')
		expect(Object.keys(controller)).not.toContain('getPort')
		expect(Object.keys(controller)).not.toContain('getClientToken')
		controller.dispose()
	})

	it('re-probes when the channel drops, and reports connected once the sidecar answers', async () => {
		const fetchInfo = vi
			.fn()
			.mockResolvedValueOnce({ isRunning: true })
			.mockResolvedValueOnce({ isRunning: true })
		const statuses: string[] = []
		const controller = createSidecarStatusController(fetchInfo)
		await controller.init()
		controller.subscribe((status) => statuses.push(status))
		controller.reportChannelDown()
		await vi.waitFor(() => expect(statuses.at(-1)).toBe('connected'))
		expect(statuses).toEqual(['connected', 'reviving', 'connected'])
		expect(fetchInfo).toHaveBeenCalledTimes(2)
		controller.dispose()
	})

	it('does not show the assistant when spawning is disabled', async () => {
		const controller = createSidecarStatusController(async () => ({
			disabled: true,
		}))
		expect(await controller.init()).toBe(false)
		controller.dispose()
	})
})
