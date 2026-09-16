import {
	OVERLAY_BOX_SHADOW,
	OVERLAY_DEFAULT_WIDTH_PX,
	OVERLAY_DOM_ID,
	OVERLAY_IFRAME_ID,
	OVERLAY_MIN_WIDTH_PX,
	OVERLAY_OUTSIDE_TOGGLE_SUPPRESS_MS,
	OVERLAY_PLACEHOLDER_ID,
	OVERLAY_RESIZE_HANDLE_SIZE_PX,
	OVERLAY_Z_INDEX,
	PLACEHOLDER_CONNECTING_TEXT,
	PLACEHOLDER_REVIVING_TEXT,
	PLACEHOLDER_UNAVAILABLE_TEXT,
	PLACEHOLDER_UNAVAILABLE_TITLE,
} from './constants'
import {
	type OverlayPrefs,
	readPrefs,
	writePrefsDebounced,
} from './overlay-prefs'
import {
	type HostTheme,
	installThemeBridge,
	readHostMode,
} from './theme-bridge'

// What the host-origin placeholder shows while the sidecar frame can't be shown.
// `connecting`/`reviving` are transient (spinner); `unavailable` is terminal.
export type PlaceholderKind = 'connecting' | 'reviving' | 'unavailable'

export interface OverlayHandle {
	// Toggle the docked panel's slide-in open/closed state.
	toggleOpen: () => void
	// Launcher-specific toggle: ignores an open request that immediately follows
	// an outside-click close, since the launcher's `click` fires after the same
	// `pointerdown` that already closed the panel. The keyboard shortcut must
	// use `toggleOpen` so it is never suppressed.
	toggleFromLauncher: () => void
	isOpen: () => boolean
	// Point the frame at a (possibly new) sidecar URL. A no-op when the URL is
	// unchanged and already loaded, so a redundant `connected` notify won't reload
	// the chatbox; otherwise it reloads and shows a connecting placeholder until
	// the frame paints.
	repoint: (url: string) => void
	// Cover the frame with the host-origin status panel (never the browser's raw
	// error page) while the sidecar is unreachable.
	showPlaceholder: (kind: PlaceholderKind) => void
}

interface OverlayElements {
	container: HTMLDivElement
	iframe: HTMLIFrameElement
	resizeHandle: HTMLDivElement
	placeholder: HTMLDivElement
}

interface OverlayPrefsRef {
	value: OverlayPrefs
}

interface MessageData {
	type?: unknown
}

const MAX_WIDTH_VW_RATIO = 0.94
// Message types accepted from the chatbox iframe to close the panel.
const CLOSE_MESSAGE_TYPES = new Set(['dms-ai:close'])

// Fallback backdrop shown behind the iframe while it slides in, before the
// bridge reports the host's real `--ui-bg`. Only briefly visible.
const BACKDROP_DARK = '#0a0b12'
const BACKDROP_LIGHT = '#ffffff'

function backdropFor(mode: 'dark' | 'light'): string {
	return mode === 'dark' ? BACKDROP_DARK : BACKDROP_LIGHT
}

function maxWidth(): number {
	const vw = globalThis.innerWidth ?? OVERLAY_DEFAULT_WIDTH_PX * 3
	return Math.max(OVERLAY_MIN_WIDTH_PX, Math.round(vw * MAX_WIDTH_VW_RATIO))
}

function clampWidth(width: number): number {
	return Math.min(Math.max(width, OVERLAY_MIN_WIDTH_PX), maxWidth())
}

function buildContainer(): HTMLDivElement {
	const container = document.createElement('div')
	container.id = OVERLAY_DOM_ID
	const style = container.style
	style.position = 'fixed'
	style.top = '0'
	style.right = '0'
	style.height = '100vh'
	style.zIndex = String(OVERLAY_Z_INDEX)
	style.boxShadow = OVERLAY_BOX_SHADOW
	// Backdrop behind the iframe while it slides in — follow the host mode so a
	// light-mode host doesn't flash a dark sheet. The iframe fills the container
	// once painted, so this is only ever briefly visible.
	style.background = backdropFor(readHostMode())
	style.borderLeft = '1px solid rgba(140,160,220,0.20)'
	style.overflow = 'hidden'
	style.display = 'flex'
	style.transition = 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)'
	style.willChange = 'transform'
	return container
}

// Built with no `src`: the frame is only pointed at the sidecar via `repoint`
// once the status controller confirms a reachable port, so the browser never
// renders its native "can't reach" page for a dead port.
function buildIframe(): HTMLIFrameElement {
	const iframe = document.createElement('iframe')
	iframe.id = OVERLAY_IFRAME_ID
	iframe.style.flex = '1 1 auto'
	iframe.style.width = '100%'
	iframe.style.height = '100%'
	iframe.style.border = '0'
	iframe.style.colorScheme = readHostMode()
	return iframe
}

const SPINNER_STYLE_ID = 'dms-ai-overlay-spinner-style'

function ensureSpinnerKeyframes(): void {
	if (document.getElementById(SPINNER_STYLE_ID) !== null) return
	const style = document.createElement('style')
	style.id = SPINNER_STYLE_ID
	style.textContent =
		'@keyframes dms-ai-spin{to{transform:rotate(360deg)}}'
	document.head.appendChild(style)
}

function buildPlaceholder(): HTMLDivElement {
	const placeholder = document.createElement('div')
	placeholder.id = OVERLAY_PLACEHOLDER_ID
	const style = placeholder.style
	style.position = 'absolute'
	style.inset = '0'
	// Above the iframe, but transparent to pointers so the resize handle and the
	// (harmless) dead frame beneath stay reachable.
	style.zIndex = '2'
	style.pointerEvents = 'none'
	style.display = 'none'
	style.flexDirection = 'column'
	style.alignItems = 'center'
	style.justifyContent = 'center'
	style.gap = '14px'
	style.padding = '24px'
	style.textAlign = 'center'
	style.font =
		'500 13px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
	style.background = backdropFor(readHostMode())
	return placeholder
}

function spinnerHtml(color: string): string {
	return `<span style="width:22px;height:22px;border:2.5px solid ${color}33;border-top-color:${color};border-radius:50%;animation:dms-ai-spin 0.7s linear infinite;"></span>`
}

function placeholderContent(kind: PlaceholderKind): string {
	if (kind === 'unavailable') {
		return `<div style="font-size:15px;font-weight:600;">${PLACEHOLDER_UNAVAILABLE_TITLE}</div><div style="opacity:0.7;">${PLACEHOLDER_UNAVAILABLE_TEXT}</div>`
	}
	const text =
		kind === 'reviving'
			? PLACEHOLDER_REVIVING_TEXT
			: PLACEHOLDER_CONNECTING_TEXT
	return `${spinnerHtml('currentColor')}<div style="opacity:0.75;">${text}</div>`
}

function buildResizeHandle(): HTMLDivElement {
	const handle = document.createElement('div')
	const style = handle.style
	style.position = 'absolute'
	style.left = '0'
	style.top = '0'
	style.width = `${OVERLAY_RESIZE_HANDLE_SIZE_PX}px`
	style.height = '100%'
	style.cursor = 'ew-resize'
	style.touchAction = 'none'
	style.zIndex = '1'
	return handle
}

function applyPrefs(elements: OverlayElements, prefs: OverlayPrefs): void {
	const width = clampWidth(prefs.width)
	elements.container.style.width = `${width}px`
	elements.container.style.transform = prefs.isOpen
		? 'translateX(0)'
		: 'translateX(100%)'
}

function resolveInitialPrefs(): OverlayPrefs {
	const stored = readPrefs()
	if (stored !== null)
		return { width: clampWidth(stored.width), isOpen: stored.isOpen }
	return { width: OVERLAY_DEFAULT_WIDTH_PX, isOpen: false }
}

interface InteractionContext {
	elements: OverlayElements
	stateRef: OverlayPrefsRef
}

function installWidthResize(ctx: InteractionContext): void {
	const { resizeHandle, container, iframe } = ctx.elements
	let startX = 0
	let startWidth = 0

	const onMove = (event: PointerEvent): void => {
		// Panel is pinned right, so dragging left (smaller clientX) grows it.
		const next = clampWidth(startWidth + (startX - event.clientX))
		ctx.stateRef.value = { ...ctx.stateRef.value, width: next }
		container.style.width = `${next}px`
	}

	const onUp = (): void => {
		globalThis.removeEventListener('pointermove', onMove)
		globalThis.removeEventListener('pointerup', onUp)
		// Restore the iframe's pointer capture now the drag is over.
		iframe.style.pointerEvents = ''
		writePrefsDebounced(ctx.stateRef.value)
	}

	resizeHandle.addEventListener('pointerdown', (event: PointerEvent) => {
		event.preventDefault()
		startX = event.clientX
		startWidth = ctx.stateRef.value.width
		// While dragging, dragging over the iframe would let it swallow the
		// pointer stream, so the parent never sees pointermove/up and the drag
		// sticks. Make the iframe transparent to pointers for the drag's duration.
		iframe.style.pointerEvents = 'none'
		globalThis.addEventListener('pointermove', onMove)
		globalThis.addEventListener('pointerup', onUp)
	})
}

// Close the panel when the user clicks anywhere in the host page outside it.
// Clicks inside the iframe never reach the host document, so they can't close
// the panel. Returns a predicate telling whether an outside click just closed
// the panel: the header launcher toggles on `click`, which follows the same
// `pointerdown` that closed the panel — without this guard, clicking the
// launcher while open would close then immediately re-open it.
function installOutsideClickClose(ctx: InteractionContext): () => boolean {
	let lastCloseAt = Number.NEGATIVE_INFINITY
	document.addEventListener(
		'pointerdown',
		(event: PointerEvent) => {
			if (!ctx.stateRef.value.isOpen) return
			if (event.composedPath().includes(ctx.elements.container)) return
			lastCloseAt = event.timeStamp
			setOpen(ctx.elements, ctx.stateRef, false)
		},
		{ capture: true },
	)
	return (): boolean =>
		performance.now() - lastCloseAt < OVERLAY_OUTSIDE_TOGGLE_SUPPRESS_MS
}

function appendElements(elements: OverlayElements): void {
	elements.container.appendChild(elements.iframe)
	elements.container.appendChild(elements.placeholder)
	elements.container.appendChild(elements.resizeHandle)
	document.body.appendChild(elements.container)
}

interface PlaceholderController {
	show: (kind: PlaceholderKind) => void
	hide: () => void
	recolor: (theme: HostTheme) => void
}

function createPlaceholderController(
	placeholder: HTMLDivElement,
): PlaceholderController {
	return {
		show: (kind) => {
			placeholder.innerHTML = placeholderContent(kind)
			placeholder.style.display = 'flex'
		},
		hide: () => {
			placeholder.style.display = 'none'
		},
		recolor: (theme) => {
			placeholder.style.background =
				theme.tokens['--ui-bg'] || backdropFor(theme.mode)
			placeholder.style.color = theme.tokens['--ui-text'] || ''
		},
	}
}

// Repoint the frame at `url`, deferring the placeholder-hide until it paints so a
// port change reloads the chatbox without flashing the previous dead frame. A
// no-op reload when the URL is already loaded.
function createRepointer(
	iframe: HTMLIFrameElement,
	placeholder: PlaceholderController,
): (url: string) => void {
	let currentUrl = ''
	let loaded = false
	iframe.addEventListener('load', () => {
		if (iframe.src === '') return
		loaded = true
		placeholder.hide()
	})
	return (url: string): void => {
		if (url === currentUrl && loaded) {
			placeholder.hide()
			return
		}
		currentUrl = url
		loaded = false
		placeholder.show('connecting')
		iframe.src = url
	}
}

function setOpen(
	elements: OverlayElements,
	stateRef: OverlayPrefsRef,
	isOpen: boolean,
): void {
	stateRef.value = { ...stateRef.value, isOpen }
	applyPrefs(elements, stateRef.value)
	writePrefsDebounced(stateRef.value)
}

export function injectOverlay(): OverlayHandle | null {
	const isAlreadyInjected = document.getElementById(OVERLAY_DOM_ID) !== null
	if (isAlreadyInjected) return null
	ensureSpinnerKeyframes()
	const elements: OverlayElements = {
		container: buildContainer(),
		iframe: buildIframe(),
		resizeHandle: buildResizeHandle(),
		placeholder: buildPlaceholder(),
	}
	appendElements(elements)
	const placeholder = createPlaceholderController(elements.placeholder)
	const repoint = createRepointer(elements.iframe, placeholder)
	const stateRef = { value: resolveInitialPrefs() }
	applyPrefs(elements, stateRef.value)
	installWidthResize({ elements, stateRef })
	const wasJustClosedByOutsideClick = installOutsideClickClose({
		elements,
		stateRef,
	})
	// Mirror the host's primary palette + light/dark mode into the iframe, and
	// keep the panel backdrop / iframe color-scheme (and the status placeholder)
	// following live mode changes (e.g. an OS-driven dark switch) so no light edge
	// lingers until a reload.
	installThemeBridge(elements.iframe, (theme) => {
		elements.container.style.background =
			theme.tokens['--ui-bg'] || backdropFor(theme.mode)
		elements.iframe.style.colorScheme = theme.mode
		placeholder.recolor(theme)
	})

	// The chatbox header's close button lives inside the iframe; it asks the
	// host to slide the panel away via postMessage.
	globalThis.addEventListener('message', (event: MessageEvent) => {
		const type = (event.data as MessageData)?.type
		if (typeof type === 'string' && CLOSE_MESSAGE_TYPES.has(type)) {
			setOpen(elements, stateRef, false)
		}
	})

	const toggle = (): void =>
		setOpen(elements, stateRef, !stateRef.value.isOpen)

	return {
		toggleOpen: toggle,
		toggleFromLauncher: (): void => {
			const wouldOpen = !stateRef.value.isOpen
			if (wouldOpen && wasJustClosedByOutsideClick()) return
			toggle()
		},
		isOpen: (): boolean => stateRef.value.isOpen,
		repoint,
		showPlaceholder: (kind) => placeholder.show(kind),
	}
}
