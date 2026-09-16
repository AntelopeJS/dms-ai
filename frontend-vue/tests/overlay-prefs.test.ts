import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	OVERLAY_PREFS_DEBOUNCE_MS,
	OVERLAY_PREFS_STORAGE_KEY,
} from '../app/runtime/constants'
import {
	flushPrefsForTesting,
	type OverlayPrefs,
	readPrefs,
	resetPrefsForTesting,
	writePrefsDebounced,
} from '../app/runtime/overlay-prefs'

const SAMPLE_PREFS: OverlayPrefs = {
	width: 400,
	isOpen: false,
}

const FIRST_PREFS: OverlayPrefs = {
	width: 300,
	isOpen: false,
}

const SECOND_PREFS: OverlayPrefs = {
	width: 320,
	isOpen: false,
}

const FINAL_PREFS: OverlayPrefs = {
	width: 360,
	isOpen: true,
}

describe('overlay-prefs storage', () => {
	beforeEach(() => {
		resetPrefsForTesting()
	})

	afterEach(() => {
		resetPrefsForTesting()
	})

	it('returns null when no prefs are stored', () => {
		expect(readPrefs()).toBeNull()
	})

	it('round-trips a prefs object via debounced write then read', () => {
		writePrefsDebounced(SAMPLE_PREFS)
		flushPrefsForTesting()
		expect(readPrefs()).toEqual(SAMPLE_PREFS)
	})

	it('returns null when the stored payload is malformed JSON', () => {
		globalThis.localStorage.setItem(OVERLAY_PREFS_STORAGE_KEY, '{not json')
		expect(readPrefs()).toBeNull()
	})

	it('returns null when the stored payload is missing fields', () => {
		globalThis.localStorage.setItem(
			OVERLAY_PREFS_STORAGE_KEY,
			JSON.stringify({ x: 0, y: 0 }),
		)
		expect(readPrefs()).toBeNull()
	})
})

describe('writePrefsDebounced timing', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		resetPrefsForTesting()
	})

	afterEach(() => {
		vi.useRealTimers()
		resetPrefsForTesting()
	})

	it('does not persist before the debounce window elapses', () => {
		writePrefsDebounced(FIRST_PREFS)
		vi.advanceTimersByTime(OVERLAY_PREFS_DEBOUNCE_MS - 1)
		expect(readPrefs()).toBeNull()
	})

	it('persists only the last call when invoked rapidly', () => {
		writePrefsDebounced(FIRST_PREFS)
		writePrefsDebounced(SECOND_PREFS)
		writePrefsDebounced(FINAL_PREFS)
		vi.advanceTimersByTime(OVERLAY_PREFS_DEBOUNCE_MS)
		expect(readPrefs()).toEqual(FINAL_PREFS)
	})
})
