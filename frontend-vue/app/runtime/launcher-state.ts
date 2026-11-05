import { readonly, type Ref, ref, watch } from "vue";
import { LAUNCHER_FINISHED_HOLD_MS } from "./constants";

/**
 * What the header launcher shows of the assistant. `finished` marks work that
 * ended: until the panel opens when nobody saw it end, for
 * `LAUNCHER_FINISHED_HOLD_MS` when the panel was open to see it.
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

/**
 * What the launcher remembers of the assistant's work, apart from what it
 * shows: `running` while a chat works or waits, then `unseen` when that work
 * ended with the panel closed, or `seen` when it ended in front of the owner.
 */
export type LauncherMemory = "idle" | "running" | "unseen" | "seen";

export type LauncherEvent =
	| { type: "observe"; snapshot: LauncherSnapshot }
	| { type: "holdEnd" };

function isBusy(snapshot: LauncherSnapshot): boolean {
	return snapshot.working > 0 || snapshot.waiting > 0;
}

function observe(
	memory: LauncherMemory,
	snapshot: LauncherSnapshot,
): LauncherMemory {
	if (isBusy(snapshot)) return "running";
	if (memory === "running") return snapshot.isPanelOpen ? "seen" : "unseen";
	if (memory === "unseen" && snapshot.isPanelOpen) return "idle";
	return memory;
}

/**
 * The memory after an event. Work that ends is marked whatever the
 * connection shows, an open panel clears an `unseen` mark, and only the end
 * of the hold clears a `seen` one.
 */
export function rememberLauncher(
	memory: LauncherMemory,
	event: LauncherEvent,
): LauncherMemory {
	if (event.type === "holdEnd") return memory === "seen" ? "idle" : memory;
	return observe(memory, event.snapshot);
}

/**
 * The state to show: a disconnect, a question or a turn wins over everything
 * else, in that order, then a finish the memory still marks.
 */
export function displayLauncher(
	memory: LauncherMemory,
	snapshot: LauncherSnapshot,
): LauncherState {
	if (!snapshot.isConnected) return "disconnected";
	if (snapshot.waiting > 0) return "question";
	if (snapshot.working > 0) return "working";
	if (memory === "unseen" || memory === "seen") return "finished";
	return "connected";
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
 * The launcher's state, kept up to date from its sources. A finish the owner
 * saw lets go `LAUNCHER_FINISHED_HOLD_MS` after the work ended.
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
	let memory = rememberLauncher("idle", { type: "observe", snapshot: read() });
	const state = ref<LauncherState>(displayLauncher(memory, read()));
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	const clearHold = (): void => {
		if (holdTimer !== null) clearTimeout(holdTimer);
		holdTimer = null;
	};
	const apply = (event: LauncherEvent): void => {
		const previous = memory;
		memory = rememberLauncher(memory, event);
		if (memory !== "seen") clearHold();
		else if (previous !== "seen")
			holdTimer = setTimeout(
				() => apply({ type: "holdEnd" }),
				LAUNCHER_FINISHED_HOLD_MS,
			);
		state.value = displayLauncher(memory, read());
	};
	const stopWatching = watch(
		[
			sources.isConnected,
			sources.working,
			sources.waiting,
			sources.isPanelOpen,
		],
		() => apply({ type: "observe", snapshot: read() }),
	);
	return {
		state: readonly(state),
		stop: () => {
			stopWatching();
			clearHold();
		},
	};
}
