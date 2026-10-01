import { afterEach, describe, expect, it } from "vitest";
import {
	OVERLAY_DEFAULT_WIDTH_PX,
	OVERLAY_MIN_WIDTH_PX,
	OVERLAY_OUTSIDE_TOGGLE_SUPPRESS_MS,
} from "../app/runtime/constants";
import {
	flushPrefsForTesting,
	readPrefs,
	resetPrefsForTesting,
} from "../app/runtime/overlay-prefs";
import { clampWidth, createChatPanelState } from "../app/runtime/panel-state";

afterEach(() => {
	resetPrefsForTesting();
});

describe("chat panel state", () => {
	it("starts closed at the default width, then remembers what the user chose", () => {
		const panel = createChatPanelState();
		expect(panel.isOpen.value).toBe(false);
		expect(panel.width.value).toBe(OVERLAY_DEFAULT_WIDTH_PX);
		panel.toggle();
		panel.resize(520);
		panel.commitWidth();
		flushPrefsForTesting();
		expect(readPrefs()).toEqual({ width: 520, isOpen: true });
		const reloaded = createChatPanelState();
		expect(reloaded.isOpen.value).toBe(true);
		expect(reloaded.width.value).toBe(520);
	});

	it("keeps the width between the minimum and most of the viewport", () => {
		expect(clampWidth(10)).toBe(OVERLAY_MIN_WIDTH_PX);
		expect(clampWidth(100_000)).toBeLessThan(globalThis.innerWidth);
	});

	it("does not let the launcher reopen the panel an outside click just closed", () => {
		const panel = createChatPanelState();
		panel.toggle();
		panel.closeFromOutside(performance.now());
		panel.toggleFromLauncher();
		expect(panel.isOpen.value).toBe(false);
	});

	it("lets the launcher open the panel again a moment later, and the shortcut at once", () => {
		const panel = createChatPanelState();
		panel.toggle();
		panel.closeFromOutside(performance.now());
		panel.toggle();
		expect(panel.isOpen.value).toBe(true);
		panel.closeFromOutside(
			performance.now() - OVERLAY_OUTSIDE_TOGGLE_SUPPRESS_MS - 1,
		);
		panel.toggleFromLauncher();
		expect(panel.isOpen.value).toBe(true);
	});
});
