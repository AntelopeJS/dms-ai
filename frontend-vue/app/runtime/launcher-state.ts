import { readonly, type Ref, ref, watch } from "vue";
import { LAUNCHER_FINISHED_HOLD_MS } from "./constants";

/**
 * What the header launcher shows of the assistant. `finished` is a latch: it
 * marks a turn or a question that ended while nobody looked, until the panel
 * opens.
 */
export type LauncherState =
	| "disconnected"
	| "connected"
	| "working"
	| "finished"
	| "question";

/** What the launcher's state follows at one moment. */
export interface LauncherSnapshot {
	/** The sidecar answers. */
	isConnected: boolean;
	/** Chats running a turn. */
	working: number;
	/** Approvals and questions waiting for the user. */
	waiting: number;
	isPanelOpen: boolean;
}

type PressingState = Extract<
	LauncherState,
	"disconnected" | "question" | "working"
>;

interface AtRest {
	whenPanelClosed: LauncherState;
	whenPanelOpen: LauncherState;
}

/**
 * Where each state goes when nothing works or waits. Work that ends latches
 * `finished`; the latch holds while the panel is closed and lets go once it
 * is open, which `createLauncherState` times for a panel that was open already.
 */
const AT_REST: Record<LauncherState, AtRest> = {
	disconnected: { whenPanelClosed: "connected", whenPanelOpen: "connected" },
	connected: { whenPanelClosed: "connected", whenPanelOpen: "connected" },
	working: { whenPanelClosed: "finished", whenPanelOpen: "finished" },
	question: { whenPanelClosed: "finished", whenPanelOpen: "finished" },
	finished: { whenPanelClosed: "finished", whenPanelOpen: "connected" },
};

/** The state something presses for, in priority order; `null` when all is idle. */
function pressingState(snapshot: LauncherSnapshot): PressingState | null {
	if (!snapshot.isConnected) return "disconnected";
	if (snapshot.waiting > 0) return "question";
	if (snapshot.working > 0) return "working";
	return null;
}

/**
 * The next state: a disconnect, a question or a turn wins over everything
 * else, in that order, and an idle assistant settles as `AT_REST` says.
 */
export function nextLauncherState(
	previous: LauncherState,
	snapshot: LauncherSnapshot,
): LauncherState {
	const pressing = pressingState(snapshot);
	if (pressing !== null) return pressing;
	const rest = AT_REST[previous];
	return snapshot.isPanelOpen ? rest.whenPanelOpen : rest.whenPanelClosed;
}

export interface LauncherSources {
	isConnected: Readonly<Ref<boolean>>;
	working: Readonly<Ref<number>>;
	waiting: Readonly<Ref<number>>;
	isPanelOpen: Readonly<Ref<boolean>>;
}

export interface LauncherStateHandle {
	state: Readonly<Ref<LauncherState>>;
	stop: () => void;
}

/**
 * The launcher's state, kept up to date from its sources. A `finished` that
 * lands while the panel is open lets go after `LAUNCHER_FINISHED_HOLD_MS`.
 */
export function createLauncherState(
	sources: LauncherSources,
): LauncherStateHandle {
	const read = (): LauncherSnapshot => ({
		isConnected: sources.isConnected.value,
		working: sources.working.value,
		waiting: sources.waiting.value,
		isPanelOpen: sources.isPanelOpen.value,
	});
	const state = ref<LauncherState>(nextLauncherState("disconnected", read()));
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	const clearHold = (): void => {
		if (holdTimer !== null) clearTimeout(holdTimer);
		holdTimer = null;
	};
	const settle = (): void => {
		clearHold();
		state.value = nextLauncherState(state.value, read());
		if (state.value === "finished" && sources.isPanelOpen.value)
			holdTimer = setTimeout(settle, LAUNCHER_FINISHED_HOLD_MS);
	};
	const stopWatching = watch(
		[
			sources.isConnected,
			sources.working,
			sources.waiting,
			sources.isPanelOpen,
		],
		settle,
	);
	return {
		state: readonly(state),
		stop: () => {
			stopWatching();
			clearHold();
		},
	};
}
