// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import LauncherIcon from "../app/components/LauncherIcon.vue";
import type { LauncherState } from "../app/runtime/launcher-state";
import { createHarness, providedSession } from "./support/panel-harness";

const UIcon = defineComponent({
	name: "UIcon",
	props: { name: { type: String, required: true } },
	setup: (props) => () => h("i", { class: "u-icon", "data-name": props.name }),
});

const mounted: Array<{ unmount: () => void }> = [];

afterEach(() => {
	mounted.splice(0).forEach((wrapper) => wrapper.unmount());
});

function mountIcon(provide: ReturnType<typeof providedSession>) {
	const wrapper = mount(LauncherIcon, {
		global: { provide, components: { UIcon } },
	});
	mounted.push(wrapper);
	return wrapper;
}

describe("the launcher icon", () => {
	it("follows the session's state as it changes, one data-state per state", async () => {
		const harness = createHarness();
		const wrapper = mountIcon(providedSession(harness.session));
		const states: LauncherState[] = [
			"working",
			"question",
			"finished",
			"disconnected",
			"connected",
		];
		expect(wrapper.attributes("data-state")).toBe("connected");
		for (const state of states) {
			harness.launcherState.value = state;
			await nextTick();
			expect(wrapper.attributes("data-state")).toBe(state);
		}
	});

	it("draws the sparkle and a status dot, hidden from assistive technology", () => {
		const wrapper = mountIcon(providedSession(createHarness().session));
		expect(wrapper.attributes("aria-hidden")).toBe("true");
		expect(wrapper.find(".u-icon").attributes("data-name")).toBe(
			"i-ph-sparkle",
		);
		expect(wrapper.find(".dms-ai-launcher__dot").exists()).toBe(true);
	});

	it("draws the plain sparkle before the session exists", async () => {
		const wrapper = mountIcon(providedSession(null));
		expect(wrapper.attributes("data-state")).toBe("connected");
		expect(wrapper.find(".u-icon").exists()).toBe(true);
	});
});
