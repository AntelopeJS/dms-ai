// @vitest-environment jsdom
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick, ref, shallowRef } from "vue";
import { publicAssistantActions } from "../app/runtime/assistant-actions";
import { paletteSource } from "../app/runtime/assistant-commands";
import {
	createSidecarStatusController,
	type SidecarInfoPayload,
} from "../app/runtime/sidecar-status";
import { createTestI18n } from "./support/i18n";
import {
	buttonWithText,
	CONVERSATION_ID,
	createHarness,
	deliver,
	openPanel,
	sendMessage,
	sentOfType,
	unmountPanel,
} from "./support/panel-harness";

const SCOPE_LABEL = "Code mode";
const APPROVAL_LABEL = "Ask first";

beforeEach(() => {
	localStorage.setItem("dms-ai-conversation-id", CONVERSATION_ID);
});

afterEach(() => {
	unmountPanel();
	localStorage.clear();
});

function composerBar(panel: VueWrapper): string {
	return panel.find(".cb-input__bar").text();
}

function assistantSwitch(panel: VueWrapper) {
	return panel.find(".composer-assistant");
}

describe("an owner in development picks Builder or Analyst per conversation", () => {
	it("starts a new conversation in Builder, with its scope and approval mode", async () => {
		const panel = await openPanel(createHarness());
		expect(assistantSwitch(panel).text()).toContain("Builder");
		expect(composerBar(panel)).toContain(SCOPE_LABEL);
		expect(composerBar(panel)).toContain(APPROVAL_LABEL);
	});

	it("sends the conversation's new assistant when Analyst is picked, and hides the Builder's controls", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		await buttonWithText(panel.find(".cb-input__bar"), "Analyst").trigger(
			"click",
		);
		expect(sentOfType(harness, "set_conversation_mode")).toEqual([
			{
				type: "set_conversation_mode",
				conversationId: CONVERSATION_ID,
				assistant: "analyst",
			},
		]);
		expect(assistantSwitch(panel).text()).toContain("Analyst");
		expect(composerBar(panel)).not.toContain(SCOPE_LABEL);
		expect(composerBar(panel)).not.toContain(APPROVAL_LABEL);
	});

	it("follows the assistant the sidecar reports for the conversation", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		deliver(harness, {
			type: "conversation_mode",
			assistant: "analyst",
			mode: "normal",
			generationMode: "vibe",
		});
		await nextTick();
		expect(assistantSwitch(panel).text()).toContain("Analyst");
		expect(composerBar(panel)).not.toContain(SCOPE_LABEL);
	});
});

describe("a user who may run the Analyst only", () => {
	it("sees no mode switch and none of the Builder's controls or pages", async () => {
		const harness = createHarness(["analyst"]);
		const panel = await openPanel(harness);
		expect(assistantSwitch(panel).exists()).toBe(false);
		expect(composerBar(panel)).not.toContain(SCOPE_LABEL);
		expect(composerBar(panel)).not.toContain(APPROVAL_LABEL);
		expect(panel.text()).not.toContain("Open changes");
		expect(panel.find("textarea").attributes("placeholder")).toBe(
			"Ask a question about your data…",
		);
	});

	it("still chats, and sets no approval mode a module asks for", async () => {
		const harness = createHarness(["analyst"]);
		const panel = await openPanel(harness);
		await sendMessage(panel, "How many orders this week?");
		expect(sentOfType(harness, "user_message")).toMatchObject([
			{
				conversationId: CONVERSATION_ID,
				content: "How many orders this week?",
			},
		]);
		publicAssistantActions(shallowRef(harness.session)).startConversation(
			"Plan it",
			{ mode: "plan" },
		);
		await flushPromises();
		expect(sentOfType(harness, "set_conversation_mode")).toEqual([]);
	});

	it("is offered no restart or settings when the sidecar gave up", async () => {
		const harness = createHarness(["analyst"]);
		harness.sidecarStatus.value = "unavailable";
		const panel = await openPanel(harness);
		expect(panel.text()).not.toContain("Restart assistant");
		expect(panel.text()).not.toContain("Settings");
	});
});

describe("the palette's entries", () => {
	const { t } = createTestI18n();
	const ids = (source: ReturnType<typeof paletteSource>): string[] =>
		source.groups().flatMap((group) => group.items.map((item) => item.id));

	it("leave out the approvals and the Changes page without the Builder's actions", () => {
		const source = paletteSource(t, ref(0), {
			ask: () => undefined,
			startConversation: () => undefined,
		});
		expect(ids(source)).toEqual(["dms-ai-ask", "dms-ai-new"]);
	});

	it("offer the approvals and the Changes page with them", () => {
		const source = paletteSource(t, ref(0), {
			ask: () => undefined,
			startConversation: () => undefined,
			reviewApprovals: () => undefined,
			openChanges: () => undefined,
		});
		expect(ids(source)).toEqual([
			"dms-ai-ask",
			"dms-ai-new",
			"dms-ai-approvals",
			"dms-ai-changes",
		]);
	});
});

describe("the modes the sidecar info names", () => {
	function answering(body: SidecarInfoPayload | Record<string, unknown>) {
		return () => ({
			data: ref(body as SidecarInfoPayload),
			error: ref(null),
			pending: ref(false),
			execute: async () => undefined,
			refresh: async () => undefined,
		});
	}

	it("are the ones the backend answers", async () => {
		const controller = createSidecarStatusController(
			answering({ isRunning: true, modes: ["builder", "analyst"] }),
		);
		expect(await controller.init()).toBe(true);
		expect(controller.getModes()).toEqual(["builder", "analyst"]);
		controller.dispose();
	});

	it("are the Analyst alone when the answer names none it knows", async () => {
		const controller = createSidecarStatusController(
			answering({ isRunning: true, modes: ["root"] }),
		);
		expect(await controller.init()).toBe(true);
		expect(controller.getModes()).toEqual(["analyst"]);
		controller.dispose();
	});
});
