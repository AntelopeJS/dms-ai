import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { LAUNCHER_FINISHED_HOLD_MS } from "../app/runtime/constants";
import {
	createLauncherState,
	displayLauncher,
	type LauncherSnapshot,
} from "../app/runtime/launcher-state";

function launcher() {
	const isConnected = ref(true);
	const working = ref(0);
	const waiting = ref(0);
	const isPanelOpen = ref(false);
	const handle = createLauncherState({
		isConnected,
		working,
		waiting,
		isPanelOpen,
	});
	return { isConnected, working, waiting, isPanelOpen, ...handle };
}

async function settled<T>(change: () => T): Promise<void> {
	change();
	await nextTick();
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

const IDLE: LauncherSnapshot = {
	isConnected: true,
	working: 0,
	waiting: 0,
	isPanelOpen: false,
};

describe("the launcher's priorities", () => {
	it("ranks a disconnect over a question, a question over a turn, a turn over a finish (fails on any other order)", () => {
		const busy = { ...IDLE, working: 2, waiting: 1 };
		expect(displayLauncher("unseen", busy)).toBe("question");
		expect(displayLauncher("unseen", { ...busy, waiting: 0 })).toBe("working");
		expect(displayLauncher("unseen", { ...busy, isConnected: false })).toBe(
			"disconnected",
		);
		expect(displayLauncher("unseen", IDLE)).toBe("finished");
		expect(displayLauncher("idle", IDLE)).toBe("connected");
	});
});

describe("the launcher's state over a turn", () => {
	it("latches finished when a turn ends with the panel closed, and keeps it until the panel opens", async () => {
		const sources = launcher();
		expect(sources.state.value).toBe("connected");
		await settled(() => (sources.working.value = 1));
		expect(sources.state.value).toBe("working");
		await settled(() => (sources.working.value = 0));
		expect(sources.state.value).toBe("finished");
		await vi.advanceTimersByTimeAsync(10 * LAUNCHER_FINISHED_HOLD_MS);
		expect(sources.state.value).toBe("finished");
		await settled(() => (sources.isPanelOpen.value = true));
		expect(sources.state.value).toBe("connected");
		sources.stop();
	});

	it("shows a question, goes back to working once it is answered, then finishes", async () => {
		const sources = launcher();
		await settled(() => (sources.working.value = 1));
		await settled(() => (sources.waiting.value = 1));
		expect(sources.state.value).toBe("question");
		await settled(() => (sources.waiting.value = 0));
		expect(sources.state.value).toBe("working");
		await settled(() => (sources.working.value = 0));
		expect(sources.state.value).toBe("finished");
		sources.stop();
	});

	it("latches finished when a question goes away with no turn running", async () => {
		const sources = launcher();
		await settled(() => (sources.waiting.value = 1));
		expect(sources.state.value).toBe("question");
		await settled(() => (sources.waiting.value = 0));
		expect(sources.state.value).toBe("finished");
		sources.stop();
	});

	it("holds finished briefly when the panel was already open to see the turn end, then lets go", async () => {
		const sources = launcher();
		sources.isPanelOpen.value = true;
		await settled(() => (sources.working.value = 1));
		await settled(() => (sources.working.value = 0));
		expect(sources.state.value).toBe("finished");
		await vi.advanceTimersByTimeAsync(LAUNCHER_FINISHED_HOLD_MS - 1);
		expect(sources.state.value).toBe("finished");
		await vi.advanceTimersByTimeAsync(1);
		expect(sources.state.value).toBe("connected");
		sources.stop();
	});

	it("lets a new turn override finished, and times the next finished from its own end", async () => {
		const sources = launcher();
		sources.isPanelOpen.value = true;
		await settled(() => (sources.working.value = 1));
		await settled(() => (sources.working.value = 0));
		await vi.advanceTimersByTimeAsync(1_000);
		await settled(() => (sources.working.value = 1));
		expect(sources.state.value).toBe("working");
		await vi.advanceTimersByTimeAsync(LAUNCHER_FINISHED_HOLD_MS);
		expect(sources.state.value).toBe("working");
		await settled(() => (sources.working.value = 0));
		expect(sources.state.value).toBe("finished");
		await vi.advanceTimersByTimeAsync(LAUNCHER_FINISHED_HOLD_MS - 1);
		expect(sources.state.value).toBe("finished");
		await vi.advanceTimersByTimeAsync(1);
		expect(sources.state.value).toBe("connected");
		sources.stop();
	});

	it("shows disconnected over a running turn and a question, then follows them again (fails if a disconnect is not an override)", async () => {
		const sources = launcher();
		await settled(() => (sources.working.value = 1));
		await settled(() => (sources.waiting.value = 1));
		await settled(() => (sources.isConnected.value = false));
		expect(sources.state.value).toBe("disconnected");
		await settled(() => (sources.isConnected.value = true));
		expect(sources.state.value).toBe("question");
		sources.stop();
	});

	it("keeps an unseen finish across a disconnect (fails if the disconnected display resets the latch)", async () => {
		const sources = launcher();
		await settled(() => (sources.working.value = 1));
		await settled(() => (sources.working.value = 0));
		expect(sources.state.value).toBe("finished");
		await settled(() => (sources.isConnected.value = false));
		expect(sources.state.value).toBe("disconnected");
		await settled(() => (sources.isConnected.value = true));
		expect(sources.state.value).toBe("finished");
		sources.stop();
	});

	it("finishes a turn that ended while disconnected once the sidecar is back (fails if the latch follows the displayed state)", async () => {
		const sources = launcher();
		await settled(() => (sources.working.value = 1));
		await settled(() => (sources.isConnected.value = false));
		await settled(() => (sources.working.value = 0));
		expect(sources.state.value).toBe("disconnected");
		await settled(() => (sources.isConnected.value = true));
		expect(sources.state.value).toBe("finished");
		await settled(() => (sources.isPanelOpen.value = true));
		expect(sources.state.value).toBe("connected");
		sources.stop();
	});

	it("clears a finish the owner saw on its timer even when the panel closes during the hold (fails if closing the panel cancels the hold)", async () => {
		const sources = launcher();
		sources.isPanelOpen.value = true;
		await settled(() => (sources.working.value = 1));
		await settled(() => (sources.working.value = 0));
		expect(sources.state.value).toBe("finished");
		await vi.advanceTimersByTimeAsync(1_000);
		await settled(() => (sources.isPanelOpen.value = false));
		expect(sources.state.value).toBe("finished");
		await vi.advanceTimersByTimeAsync(LAUNCHER_FINISHED_HOLD_MS - 1_000);
		expect(sources.state.value).toBe("connected");
		await vi.advanceTimersByTimeAsync(60_000);
		expect(sources.state.value).toBe("connected");
		sources.stop();
	});

	it("keeps the hold's deadline when the panel reopens during it (fails if a panel change restarts the hold)", async () => {
		const sources = launcher();
		sources.isPanelOpen.value = true;
		await settled(() => (sources.working.value = 1));
		await settled(() => (sources.working.value = 0));
		await vi.advanceTimersByTimeAsync(1_000);
		await settled(() => (sources.isPanelOpen.value = false));
		await settled(() => (sources.isPanelOpen.value = true));
		expect(sources.state.value).toBe("finished");
		await vi.advanceTimersByTimeAsync(LAUNCHER_FINISHED_HOLD_MS - 1_001);
		expect(sources.state.value).toBe("finished");
		await vi.advanceTimersByTimeAsync(1);
		expect(sources.state.value).toBe("connected");
		sources.stop();
	});

	it("starts disconnected when the sidecar is not there at the first look", () => {
		const isConnected = ref(false);
		const handle = createLauncherState({
			isConnected,
			working: ref(0),
			waiting: ref(0),
			isPanelOpen: ref(false),
		});
		expect(handle.state.value).toBe("disconnected");
		handle.stop();
	});

	it("stops following and drops the pending hold when stopped", async () => {
		const sources = launcher();
		sources.isPanelOpen.value = true;
		await settled(() => (sources.working.value = 1));
		await settled(() => (sources.working.value = 0));
		sources.stop();
		expect(vi.getTimerCount()).toBe(0);
		await settled(() => (sources.working.value = 1));
		expect(sources.state.value).toBe("finished");
	});
});
