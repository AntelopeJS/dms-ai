// @vitest-environment jsdom
import type { VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import {
	CONVERSATION_ID,
	createHarness,
	deliver,
	openPanel,
	unmountPanel,
} from "./support/panel-harness";

beforeEach(() => {
	localStorage.setItem("dms-ai-conversation-id", CONVERSATION_ID);
});

afterEach(() => {
	unmountPanel();
	localStorage.clear();
});

const SETTINGS = {
	defaultModes: { claude: "auto", codex: "normal" },
	thinking: "medium",
	generationMode: "safe",
	allowLocalSkills: false,
};

const PROVIDERS = {
	claude: { available: true },
	codex: { available: true },
};

function modePill(panel: VueWrapper) {
	const pills = panel.findAll(".cb-mode-btn");
	return pills[pills.length - 1];
}

function pickerItems(panel: VueWrapper): string[] {
	const menu = modePill(panel).element.closest(".u-dropdown");
	return Array.from(menu?.querySelectorAll(".u-dropdown-item") ?? []).map(
		(item) => item.textContent?.trim() ?? "",
	);
}

async function useProvider(
	harness: ReturnType<typeof createHarness>,
	provider: "claude" | "codex",
): Promise<void> {
	deliver(harness, {
		type: "settings_update",
		settings: { ...SETTINGS, provider },
		providers: PROVIDERS,
	});
	await nextTick();
}

describe("the approval mode pill", () => {
	it("shows Auto review on a fresh Claude chat, without danger styling", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		await useProvider(harness, "claude");
		const pill = modePill(panel);
		expect(pill.text()).toBe("Auto review");
		expect(pill.classes()).not.toContain("is-danger");
		expect(pickerItems(panel)).toContain("Auto review");
	});

	it("reads Ask first on Codex for a chat holding auto, and offers no Auto review", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		await useProvider(harness, "codex");
		deliver(harness, {
			type: "conversation_mode",
			mode: "auto",
			generationMode: "safe",
			fullAuto: null,
		});
		await nextTick();
		expect(modePill(panel).text()).toBe("Ask first");
		expect(pickerItems(panel)).not.toContain("Auto review");
		expect(pickerItems(panel)).toContain("Ask first");
	});

	it("gives Full auto its own pill, apart from Auto review", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		deliver(harness, {
			type: "conversation_mode",
			mode: "auto",
			generationMode: "safe",
			fullAuto: { duration: "chat" },
		});
		await nextTick();
		const pill = modePill(panel);
		expect(pill.text()).toBe("Full auto");
		expect(pill.classes()).toContain("is-danger");
		expect(panel.find(".cb-banner-auto").exists()).toBe(true);
	});

	it("says Auto review is not available, naming the model", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		deliver(harness, {
			type: "notice",
			notice: {
				kind: "auto_unavailable",
				model: "claude-haiku-4-5",
				timestampMs: Date.now(),
			},
		});
		await nextTick();
		const notice = panel.find(".cb-notice");
		expect(notice.text()).toContain("Auto review isn't available here.");
		expect(notice.text()).toContain(
			"claude-haiku-4-5, this plan or a setting doesn't allow it.",
		);
	});
});
