// Theme bridge (host → chatbox iframe). The host DMS is the source of truth for
// the active Nuxt UI primary palette and the light/dark mode; the chatbox iframe
// is a separate document (different origin) so it cannot inherit them through
// CSS — we forward them explicitly here.
//
// Protocol:
//   iframe → host : { type: "dms-ai:ready" }            (chatbox announces mount)
//   host → iframe : { type: "dms-ai:theme", mode, primary }
// See sidecar/chatbox/src/composables/useHostTheme.ts for the receiver.

const THEME_MESSAGE_TYPE = 'dms-ai:theme'
const READY_MESSAGE_TYPE = 'dms-ai:ready'

const PRIMARY_STEPS = [
	'50',
	'100',
	'200',
	'300',
	'400',
	'500',
	'600',
	'700',
	'800',
	'900',
	'950',
] as const

// Nuxt UI semantic surface/text/border tokens. The host DMS may override these
// with bespoke values (e.g. the DMS dark canvas is #0a0b12, not the default
// neutral-900), so the chatbox can't just rely on the default neutral palette —
// it has to mirror the host's resolved values for a faithful match in both modes.
const SEMANTIC_TOKENS = [
	'--ui-bg',
	'--ui-bg-muted',
	'--ui-bg-elevated',
	'--ui-bg-accented',
	'--ui-bg-inverted',
	'--ui-text-dimmed',
	'--ui-text-muted',
	'--ui-text-toned',
	'--ui-text',
	'--ui-text-highlighted',
	'--ui-text-inverted',
	'--ui-border',
	'--ui-border-muted',
	'--ui-border-accented',
	'--ui-border-inverted',
] as const

export interface HostTheme {
	mode: 'dark' | 'light'
	primary: Record<string, string>
	tokens: Record<string, string>
}

export function readHostMode(): 'dark' | 'light' {
	return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

interface ResolvedColors {
	primary: Record<string, string>
	tokens: Record<string, string>
}

// Resolve CSS custom properties to concrete color strings. They are authored as
// `var(--color-…)` chains, so we read them through a throwaway probe whose
// computed `color` forces full var() resolution (getComputedStyle on the custom
// property itself may return the unresolved `var(...)` token in some browsers).
// A variable the host does not define is skipped entirely: `color: var(--undef)`
// falls back to the *inherited* color, so the probe would otherwise report a
// bogus concrete value (e.g. black) instead of "missing" — leaving downstream
// guards/fallbacks ineffective.
function readResolvedColors(): ResolvedColors {
	const rootStyle = getComputedStyle(document.documentElement)
	const probe = document.createElement('span')
	probe.style.cssText =
		'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;'
	document.body.appendChild(probe)
	const probeStyle = getComputedStyle(probe)
	const resolve = (name: string): string => {
		if (rootStyle.getPropertyValue(name).trim() === '') return ''
		probe.style.color = `var(${name})`
		return probeStyle.color
	}
	const primary: Record<string, string> = {}
	for (const step of PRIMARY_STEPS) {
		const value = resolve(`--ui-color-primary-${step}`)
		if (value !== '') primary[step] = value
	}
	const tokens: Record<string, string> = {}
	for (const name of SEMANTIC_TOKENS) {
		const value = resolve(name)
		if (value !== '') tokens[name] = value
	}
	probe.remove()
	return { primary, tokens }
}

export function readHostTheme(): HostTheme {
	const { primary, tokens } = readResolvedColors()
	return { mode: readHostMode(), primary, tokens }
}

function themeSignature(theme: HostTheme): string {
	const primary = PRIMARY_STEPS.map((s) => theme.primary[s]).join(',')
	const tokens = SEMANTIC_TOKENS.map((t) => theme.tokens[t]).join(',')
	return `${theme.mode}|${primary}|${tokens}`
}

interface MessageData {
	type?: unknown
}

type ThemePush = (force: boolean) => void

// Only answer the handshake from our own iframe, never an arbitrary frame.
function answerReadyHandshake(
	iframe: HTMLIFrameElement,
	post: ThemePush,
): void {
	globalThis.addEventListener('message', (event: MessageEvent) => {
		const type = (event.data as MessageData)?.type
		if (type === READY_MESSAGE_TYPE && event.source === iframe.contentWindow) {
			post(true)
		}
	})
}

// @nuxtjs/color-mode toggles `.dark` on <html>; mirror those changes live.
function watchHostModeChanges(post: ThemePush): void {
	const observer = new MutationObserver(() => post(false))
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['class'],
	})
}

// Wire the bridge to a chatbox iframe: reply to its `ready` handshake and
// re-push the theme whenever the host flips light/dark. Primary/token swaps
// alone are not mirrored live — they only reach the iframe on the forced
// pushes (`ready` handshake and iframe `load`).
// `onTheme` fires on every (re)push so the caller can keep host-side chrome
// (the overlay backdrop / iframe color-scheme) in sync with live mode changes —
// without it, an OS-driven dark switch leaves the panel edge on its old shade
// until the page is reloaded.
export function installThemeBridge(
	iframe: HTMLIFrameElement,
	onTheme?: (theme: HostTheme) => void,
): void {
	let lastMode: 'dark' | 'light' | '' = ''
	let lastSignature = ''

	const post: ThemePush = (force) => {
		// The observer fires on any <html> class mutation (scroll locks, modal or
		// route classes…). Gate the expensive probe resolution behind a cheap mode
		// check: only a light/dark flip changes what this bridge mirrors live, and
		// primary/token swaps are re-pushed on the `force` paths (ready/load).
		const mode = readHostMode()
		if (!force && mode === lastMode) return
		lastMode = mode
		const theme = readHostTheme()
		const signature = themeSignature(theme)
		if (!force && signature === lastSignature) return
		lastSignature = signature
		onTheme?.(theme)
		iframe.contentWindow?.postMessage(
			{ type: THEME_MESSAGE_TYPE, ...theme },
			'*',
		)
	}

	answerReadyHandshake(iframe, post)
	watchHostModeChanges(post)
	// Belt and suspenders for the case where the iframe loaded before its
	// message listener was ready and the `ready` handshake was missed.
	iframe.addEventListener('load', () => post(true))
}
