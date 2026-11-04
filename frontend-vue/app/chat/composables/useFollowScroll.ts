import { type Ref, watch } from "vue";

const BOTTOM_EPSILON_PX = 4;

function distanceFromBottom(el: HTMLElement): number {
	return el.scrollHeight - el.scrollTop - el.clientHeight;
}

function scrollToBottom(el: HTMLElement): void {
	el.scrollTop = el.scrollHeight;
}

/**
 * Keeps a scrolling container on its newest content while it follows. The
 * view follows from the start. An upward scroll that leaves it more than a few
 * pixels from the bottom stops the following, whatever caused it (wheel, keys,
 * scrollbar, find in page, text selection). A scroll that reaches the bottom,
 * or a call to `follow`, starts it again. This holds because the scrolls made
 * here only go down, and a scroll the browser makes when content shrinks
 * still ends at the bottom. A resize of the container or of anything inside
 * it re-pins the bottom, so growth that changes no reactive data (docks,
 * images, wrapping, cards that open) is followed too.
 */
export function useFollowScroll(scrollEl: Ref<HTMLElement | null>): {
	/** Jumps to the bottom and follows from there. */
	follow: () => void;
} {
	let following = true;

	function follow(): void {
		following = true;
		if (scrollEl.value !== null) scrollToBottom(scrollEl.value);
	}

	function attach(el: HTMLElement): () => void {
		let lastTop = el.scrollTop;

		const onScroll = (): void => {
			const top = el.scrollTop;
			const movedUp = top < lastTop;
			lastTop = top;
			if (distanceFromBottom(el) <= BOTTOM_EPSILON_PX) following = true;
			else if (movedUp) following = false;
		};

		const resizes = new ResizeObserver(() => {
			if (following) scrollToBottom(el);
		});
		const observeContent = (): void => {
			resizes.disconnect();
			resizes.observe(el);
			for (const child of el.children) resizes.observe(child);
		};
		const children = new MutationObserver(observeContent);
		observeContent();
		children.observe(el, { childList: true });

		el.addEventListener("scroll", onScroll, { passive: true });

		return () => {
			resizes.disconnect();
			children.disconnect();
			el.removeEventListener("scroll", onScroll);
		};
	}

	watch(
		scrollEl,
		(el, _previous, onCleanup) => {
			if (el === null) return;
			onCleanup(attach(el));
		},
		{ immediate: true, flush: "post" },
	);

	return { follow };
}
