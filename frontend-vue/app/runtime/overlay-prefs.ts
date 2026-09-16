import {
	OVERLAY_PREFS_DEBOUNCE_MS,
	OVERLAY_PREFS_STORAGE_KEY,
} from './constants'

export interface OverlayPrefs {
	width: number
	isOpen: boolean
}

let pendingTimer: ReturnType<typeof setTimeout> | null = null
let pendingPrefs: OverlayPrefs | null = null

function tryReadStorage(): string | null {
	try {
		return globalThis.localStorage.getItem(OVERLAY_PREFS_STORAGE_KEY)
	} catch {
		return null
	}
}

function tryWriteStorage(payload: string): void {
	try {
		globalThis.localStorage.setItem(OVERLAY_PREFS_STORAGE_KEY, payload)
	} catch {
		return
	}
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function isValidPrefs(value: unknown): value is OverlayPrefs {
	if (value === null || typeof value !== 'object') return false
	const candidate = value as Record<string, unknown>
	if (!isFiniteNumber(candidate.width)) return false
	if (typeof candidate.isOpen !== 'boolean') return false
	return true
}

function parsePrefs(raw: string): OverlayPrefs | null {
	try {
		const parsed: unknown = JSON.parse(raw)
		return isValidPrefs(parsed) ? parsed : null
	} catch {
		return null
	}
}

export function readPrefs(): OverlayPrefs | null {
	const raw = tryReadStorage()
	if (raw === null) return null
	return parsePrefs(raw)
}

function flushPending(): void {
	if (pendingPrefs === null) return
	tryWriteStorage(JSON.stringify(pendingPrefs))
	pendingPrefs = null
	pendingTimer = null
}

export function writePrefsDebounced(prefs: OverlayPrefs): void {
	pendingPrefs = prefs
	if (pendingTimer !== null) clearTimeout(pendingTimer)
	pendingTimer = setTimeout(flushPending, OVERLAY_PREFS_DEBOUNCE_MS)
}

export function flushPrefsForTesting(): void {
	if (pendingTimer !== null) {
		clearTimeout(pendingTimer)
		pendingTimer = null
	}
	flushPending()
}

export function resetPrefsForTesting(): void {
	if (pendingTimer !== null) {
		clearTimeout(pendingTimer)
		pendingTimer = null
	}
	pendingPrefs = null
	try {
		globalThis.localStorage.removeItem(OVERLAY_PREFS_STORAGE_KEY)
	} catch {
		return
	}
}
