import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

interface PluginExports {
	default: (context: unknown) => Promise<void>
}

it('does not invoke authenticated fetching or inject the assistant for a guest', async () => {
	const source = readFileSync(
		resolve(__dirname, '../app/plugins/ai.client.ts'),
		'utf8',
	)
	const compiled = ts.transpileModule(
		source
			.replace('import.meta.env.DEV', 'true')
			.replace('import.meta.hot', 'undefined'),
		{
			compilerOptions: { module: ts.ModuleKind.CommonJS },
		},
	)
	const exports = {} as PluginExports
	const useAuthFetch = vi.fn(() => {
		throw new Error('A guest must not enter session recovery')
	})
	const requireModule = (name: string) =>
		name === '#dms-inertia/frontend-module'
			? { defineDmsPlugin: (plugin: unknown) => plugin }
			: {}
	new Function(
		'require',
		'exports',
		'useUserSession',
		'useAuthFetch',
		compiled.outputText,
	)(
		requireModule,
		exports,
		() => ({ loggedIn: { value: false } }),
		useAuthFetch,
	)
	await exports.default({})
	expect(useAuthFetch).not.toHaveBeenCalled()
})
