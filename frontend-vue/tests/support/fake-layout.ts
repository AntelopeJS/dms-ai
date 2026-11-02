type ResizeCallback = () => void;

const observers = new Set<FakeResizeObserver>();
const pendingScrollEvents = new Set<() => void>();

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

/** A frame: scroll events fire first, then resizes are reported. */
export function settleLayout(): void {
	dispatchPendingScrollEvents();
	for (const observer of [...observers]) observer.deliver();
	dispatchPendingScrollEvents();
}

export interface FakeScroller {
	/** Height of what the list draws, beside one row height per message. */
	extraContentPx: number;
	viewportPx: number;
	distanceFromBottom: () => number;
	/** What the person does: a wheel notch up, then the scroll it causes. */
	wheelTo: (scrollTop: number) => void;
	/** The person drags the scrollbar thumb up to `scrollTop`. */
	dragScrollbarTo: (scrollTop: number) => void;
	/** What the browser does by itself, such as a clamp after a shrink. */
	scrollWithoutPerson: (scrollTop: number) => void;
}

const ROW_PX = 100;

/** Gives a scroll container the geometry a browser would compute. */
export function fakeScroller(el: HTMLElement): FakeScroller {
	let scrollTop = 0;
	const dispatchScroll = (): void => {
		el.dispatchEvent(new Event("scroll"));
	};
	const scroller: FakeScroller = {
		extraContentPx: 0,
		viewportPx: 400,
		distanceFromBottom: () => el.scrollHeight - el.scrollTop - el.clientHeight,
		wheelTo: (target) => {
			dispatchPendingScrollEvents();
			el.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
			el.scrollTop = target;
			dispatchPendingScrollEvents();
		},
		dragScrollbarTo: (target) => {
			dispatchPendingScrollEvents();
			el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
			el.scrollTop = target;
			dispatchPendingScrollEvents();
			window.dispatchEvent(new MouseEvent("pointerup"));
		},
		scrollWithoutPerson: (target) => {
			dispatchPendingScrollEvents();
			el.scrollTop = target;
			dispatchPendingScrollEvents();
		},
	};
	const maxTop = (): number =>
		Math.max(0, el.scrollHeight - scroller.viewportPx);
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
				pendingScrollEvents.add(dispatchScroll);
			},
		},
	});
	return scroller;
}
