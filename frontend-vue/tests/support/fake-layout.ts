type ResizeCallback = () => void;

const observers = new Set<FakeResizeObserver>();
const pendingScrollEvents = new Set<() => void>();
const layoutPasses = new Set<() => void>();

/**
 * jsdom has no layout, so no resize ever happens by itself: a test reports
 * one with `settleLayout`, as the browser does once per frame.
 */
class FakeResizeObserver {
	private readonly targets = new Set<Element>();

	constructor(private readonly callback: ResizeCallback) {
		observers.add(this);
	}

	observe(target: Element): void {
		this.targets.add(target);
	}

	unobserve(target: Element): void {
		this.targets.delete(target);
	}

	disconnect(): void {
		this.targets.clear();
	}

	deliver(): void {
		if (this.targets.size > 0) this.callback();
	}
}

export function installResizeObserver(): void {
	Reflect.set(globalThis, "ResizeObserver", FakeResizeObserver);
}

function dispatchPendingScrollEvents(): void {
	for (const dispatch of [...pendingScrollEvents]) dispatch();
	pendingScrollEvents.clear();
}

/**
 * A frame: scroll events fire first, then layout runs and the browser clamps
 * or anchors the scroll position, then resizes are reported, and the scroll
 * events layout caused fire at the start of the next frame.
 */
export function settleLayout(): void {
	dispatchPendingScrollEvents();
	for (const pass of layoutPasses) pass();
	for (const observer of [...observers]) observer.deliver();
	dispatchPendingScrollEvents();
}

export interface FakeScroller {
	/** Height of what the list draws, beside one row height per message. */
	extraContentPx: number;
	viewportPx: number;
	distanceFromBottom: () => number;
	/** A scroll to `scrollTop` and the event it fires, from any source. */
	scrollTo: (scrollTop: number) => void;
	/**
	 * Content above the viewport shrinks by `px` at the next layout, and scroll
	 * anchoring moves the scroll position up by as much to keep the view still.
	 */
	collapseAbove: (px: number) => void;
}

const ROW_PX = 100;

/** Gives a scroll container the geometry a browser would compute. */
export function fakeScroller(el: HTMLElement): FakeScroller {
	let scrollTop = 0;
	let reportedTop = 0;
	let anchorShiftPx = 0;
	const dispatchScroll = (): void => {
		el.dispatchEvent(new Event("scroll"));
	};
	const scroller: FakeScroller = {
		extraContentPx: 0,
		viewportPx: 400,
		distanceFromBottom: () => el.scrollHeight - el.scrollTop - el.clientHeight,
		scrollTo: (target) => {
			dispatchPendingScrollEvents();
			el.scrollTop = target;
			dispatchPendingScrollEvents();
		},
		collapseAbove: (px) => {
			scroller.extraContentPx -= px;
			anchorShiftPx -= px;
		},
	};
	const maxTop = (): number =>
		Math.max(0, el.scrollHeight - scroller.viewportPx);
	layoutPasses.add(() => {
		scrollTop = Math.min(Math.max(0, el.scrollTop + anchorShiftPx), maxTop());
		anchorShiftPx = 0;
		if (scrollTop === reportedTop) return;
		reportedTop = scrollTop;
		pendingScrollEvents.add(dispatchScroll);
	});
	Object.defineProperties(el, {
		clientHeight: { get: () => scroller.viewportPx },
		scrollHeight: {
			get: () =>
				el.querySelectorAll("li").length * ROW_PX + scroller.extraContentPx,
		},
		scrollTop: {
			get: () => Math.min(scrollTop, maxTop()),
			set: (value: number) => {
				scrollTop = Math.min(Math.max(0, value), maxTop());
				reportedTop = scrollTop;
				pendingScrollEvents.add(dispatchScroll);
			},
		},
	});
	return scroller;
}
