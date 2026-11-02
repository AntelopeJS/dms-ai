import { type Ref, ref, watch } from "vue";

const BOTTOM_EPSILON_PX = 4;
const UPWARD_INTENT_WINDOW_MS = 250;
const UPWARD_KEYS: ReadonlySet<string> = new Set(["ArrowUp", "PageUp", "Home"]);

function distanceFromBottom(el: HTMLElement): number {
	return el.scrollHeight - el.scrollTop - el.clientHeight;
}

function scrollToBottom(el: HTMLElement): void {
	el.scrollTop = el.scrollHeight;
}

/**
 * Keeps a scrolling container on its newest content while it follows. The
 * view follows from the start, stops only when the person scrolls up, and
 * follows again once they return to the bottom or `follow` is called. A
 * resize of the container or of anything inside it re-pins the bottom, so
 * growth that changes no reactive data (docks, images, wrapping, cards that
 * open) is followed too. Only a person's upward scroll (wheel, touch, keys or
 * scrollbar drag) stops the following: a scroll the browser makes when content
 * shrinks, or the one made here, never does.
 */
export function useFollowScroll(scrollEl: Ref<HTMLElement | null>): {
	/** Jumps to the bottom and follows from there. */
	follow: () => void;
} {
	const following = ref(true);
	const upwardIntent = { at: Number.NEGATIVE_INFINITY };

	function follow(): void {
		following.value = true;
		upwardIntent.at = Number.NEGATIVE_INFINITY;
		if (scrollEl.value !== null) scrollToBottom(scrollEl.value);
	}

	watch(
		scrollEl,
		(el, _previous, onCleanup) => {
			if (el === null) return;
			onCleanup(attach(el, following, upwardIntent));
		},
		{ immediate: true, flush: "post" },
	);

	return { follow };
}

interface UpwardIntent {
	/** When a wheel, touch or key input last asked to scroll up. */
	at: number;
}

function attach(
	el: HTMLElement,
	following: Ref<boolean>,
	upwardIntent: UpwardIntent,
): () => void {
	let lastTop = el.scrollTop;
	let touchY: number | null = null;
	let isDraggingScrollbar = false;

	const intendUpward = (): void => {
		upwardIntent.at = performance.now();
	};
	const onWheel = (event: WheelEvent): void => {
		if (event.deltaY < 0) intendUpward();
	};
	const onKeydown = (event: KeyboardEvent): void => {
		if (UPWARD_KEYS.has(event.key)) intendUpward();
	};
	const onTouchStart = (event: TouchEvent): void => {
		touchY = event.touches[0]?.clientY ?? null;
	};
	const onTouchMove = (event: TouchEvent): void => {
		const y = event.touches[0]?.clientY;
		if (y === undefined) return;
		if (touchY !== null && y > touchY) intendUpward();
		touchY = y;
	};
	const onPointerDown = (event: PointerEvent): void => {
		isDraggingScrollbar = event.target === el;
	};
	const onPointerEnd = (): void => {
		isDraggingScrollbar = false;
	};
	const onScroll = (): void => {
		const top = el.scrollTop;
		const movedUp = top < lastTop;
		lastTop = top;
		const isPerson =
			isDraggingScrollbar ||
			performance.now() - upwardIntent.at <= UPWARD_INTENT_WINDOW_MS;
		if (movedUp && isPerson) following.value = false;
		else if (!movedUp && distanceFromBottom(el) <= BOTTOM_EPSILON_PX)
			following.value = true;
	};

	const resizes = new ResizeObserver(() => {
		if (following.value) scrollToBottom(el);
	});
	const observeContent = (): void => {
		resizes.disconnect();
		resizes.observe(el);
		for (const child of el.children) resizes.observe(child);
	};
	const children = new MutationObserver(observeContent);
	observeContent();
	children.observe(el, { childList: true });

	el.addEventListener("wheel", onWheel, { passive: true });
	el.addEventListener("keydown", onKeydown);
	el.addEventListener("touchstart", onTouchStart, { passive: true });
	el.addEventListener("touchmove", onTouchMove, { passive: true });
	el.addEventListener("pointerdown", onPointerDown);
	el.addEventListener("scroll", onScroll, { passive: true });
	window.addEventListener("pointerup", onPointerEnd);
	window.addEventListener("pointercancel", onPointerEnd);

	return () => {
		resizes.disconnect();
		children.disconnect();
		el.removeEventListener("wheel", onWheel);
		el.removeEventListener("keydown", onKeydown);
		el.removeEventListener("touchstart", onTouchStart);
		el.removeEventListener("touchmove", onTouchMove);
		el.removeEventListener("pointerdown", onPointerDown);
		el.removeEventListener("scroll", onScroll);
		window.removeEventListener("pointerup", onPointerEnd);
		window.removeEventListener("pointercancel", onPointerEnd);
	};
}
