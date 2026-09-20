import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { nextTick, ref, type Ref } from 'vue'
import { expect, it, vi } from 'vitest'
import { runWhenLoggedIn } from '../app/runtime/session-gate'

interface PluginExports {
	default: (context: unknown) => void | Promise<void>
}

interface PluginHarness {
	useAuthFetch: ReturnType<typeof vi.fn>
	run: () => void | Promise<void>
}

const SESSION_GATE_MODULE = '../runtime/session-gate'
const SIDECAR_STATUS_MODULE = '../runtime/sidecar-status'

// A first probe reporting "no assistant here" stops the startup right after the
// authenticated fetch, which is all these tests need to observe.
const silentController = {
	createSidecarStatusController: () => ({ init: async () => false }),
}

function loadPlugin(loggedIn: Ref<boolean>): PluginHarness {
	const source = readFileSync(
		resolve(__dirname, '../app/plugins/ai.client.ts'),
		'utf8',
	)
	const compiled = ts.transpileModule(
		source
			.replace('import.meta.env.DEV', 'true')
			.replace('import.meta.hot', 'undefined'),
		{ compilerOptions: { module: ts.ModuleKind.CommonJS } },
	)
	const exports = {} as PluginExports
	const useAuthFetch = vi.fn(() => ({ $authFetch: vi.fn() }))
	const requireModule = (name: string) => {
		if (name === '#dms/frontend-module') {
			return { defineDmsPlugin: (plugin: unknown) => plugin }
		}
		if (name === SESSION_GATE_MODULE) return { runWhenLoggedIn }
		if (name === SIDECAR_STATUS_MODULE) return silentController
		return {}
	}
	new Function(
		'require',
		'exports',
		'useUserSession',
		'useAuthFetch',
		compiled.outputText,
	)(requireModule, exports, () => ({ loggedIn }), useAuthFetch)
	return {
		useAuthFetch,
		run: () =>
			exports.default({
				vueApp: { onUnmount: vi.fn() },
				runWithContext: (callback: () => unknown) => callback(),
			}),
	}
}

it('does not invoke authenticated fetching or inject the assistant for a guest', async () => {
	const plugin = loadPlugin(ref(false))
	await plugin.run()
	expect(plugin.useAuthFetch).not.toHaveBeenCalled()
})

it('starts the assistant when a guest signs in without reloading the page', async () => {
	const loggedIn = ref(false)
	const plugin = loadPlugin(loggedIn)
	await plugin.run()
	expect(plugin.useAuthFetch).not.toHaveBeenCalled()

	loggedIn.value = true
	await nextTick()
	expect(plugin.useAuthFetch).toHaveBeenCalledTimes(1)
})
