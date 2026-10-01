import { type Ref, readonly, ref } from "vue";
import {
	OVERLAY_DEFAULT_WIDTH_PX,
	OVERLAY_MIN_WIDTH_PX,
	OVERLAY_OUTSIDE_TOGGLE_SUPPRESS_MS,
} from "./constants";
import {
	type OverlayPrefs,
	readPrefs,
	writePrefsDebounced,
} from "./overlay-prefs";

const MAX_WIDTH_VW_RATIO = 0.94;

/** Whether the chat panel is open and how wide it is, remembered per browser. */
export interface ChatPanelState {
	isOpen: Readonly<Ref<boolean>>;
	width: Readonly<Ref<number>>;
	/** The keyboard shortcut's toggle: never suppressed. */
	toggle: () => void;
	/**
	 * The header launcher's toggle. It ignores an open request right after an
	 * outside click closed the panel: the launcher's `click` follows the same
	 * `pointerdown` that closed it, and would open it again at once.
	 */
	toggleFromLauncher: () => void;
	close: () => void;
	/** An outside click closed the panel; `timeStamp` is the event's. */
	closeFromOutside: (timeStamp: number) => void;
	/** Resizes live, between the minimum width and most of the viewport. */
	resize: (width: number) => void;
	/** Remembers the width once a resize is over. */
	commitWidth: () => void;
}

function maxWidth(): number {
	const viewportWidth = globalThis.innerWidth ?? OVERLAY_DEFAULT_WIDTH_PX * 3;
	return Math.max(
		OVERLAY_MIN_WIDTH_PX,
		Math.round(viewportWidth * MAX_WIDTH_VW_RATIO),
	);
}

export function clampWidth(width: number): number {
	return Math.min(Math.max(width, OVERLAY_MIN_WIDTH_PX), maxWidth());
}

function resolveInitialPrefs(): OverlayPrefs {
	const stored = readPrefs();
	if (stored === null)
		return { width: OVERLAY_DEFAULT_WIDTH_PX, isOpen: false };
	return { width: clampWidth(stored.width), isOpen: stored.isOpen };
}

function isRightAfter(timeStamp: number): boolean {
	return performance.now() - timeStamp < OVERLAY_OUTSIDE_TOGGLE_SUPPRESS_MS;
}

export function createChatPanelState(): ChatPanelState {
	const initial = resolveInitialPrefs();
	const isOpen = ref(initial.isOpen);
	const width = ref(initial.width);
	let outsideCloseAt = Number.NEGATIVE_INFINITY;
	const persist = (): void =>
		writePrefsDebounced({ width: width.value, isOpen: isOpen.value });
	const setOpen = (next: boolean): void => {
		isOpen.value = next;
		persist();
	};
	return {
		isOpen: readonly(isOpen),
		width: readonly(width),
		toggle: () => setOpen(!isOpen.value),
		toggleFromLauncher: () => {
			if (!isOpen.value && isRightAfter(outsideCloseAt)) return;
			setOpen(!isOpen.value);
		},
		close: () => setOpen(false),
		closeFromOutside: (timeStamp) => {
			outsideCloseAt = timeStamp;
			setOpen(false);
		},
		resize: (next) => {
			width.value = clampWidth(next);
		},
		commitWidth: persist,
	};
}
