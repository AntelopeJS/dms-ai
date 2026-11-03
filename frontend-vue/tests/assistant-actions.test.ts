// @vitest-environment jsdom
import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { shallowRef } from "vue";
import { publicAssistantActions } from "../app/runtime/assistant-actions";
import {
	createHarness,
	openPanel,
	sentOfType,
	unmountPanel,
} from "./support/panel-harness";

afterEach(() => {
	unmountPanel();
});

const PROMPT =
	"Use dms-external-database on connection roaster, module builder-db-roaster-tables.";

describe("the assistant actions another module's layer injects", () => {
	it("start a new conversation with the composer prefilled and nothing sent", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		const actions = publicAssistantActions(shallowRef(harness.session));
		expect(actions.isAvailable).toBe(true);
		actions.startConversation(PROMPT);
		await flushPromises();
		expect((panel.find("textarea").element as HTMLTextAreaElement).value).toBe(
			PROMPT,
		);
		expect(sentOfType(harness, "user_message")).toEqual([]);
		expect(sentOfType(harness, "set_conversation_mode")).toEqual([]);
	});

	it("set the new conversation to plan mode before prefilling it, when asked", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		const actions = publicAssistantActions(shallowRef(harness.session));
		actions.startConversation(PROMPT, { mode: "plan" });
		await flushPromises();
		const started = sentOfType(harness, "hello").at(-1)?.conversationId;
		expect(sentOfType(harness, "set_conversation_mode")).toEqual([
			expect.objectContaining({ conversationId: started, mode: "plan" }),
		]);
		expect((panel.find("textarea").element as HTMLTextAreaElement).value).toBe(
			PROMPT,
		);
	});

	it("set plan mode once the stream is up, when the panel opens before it", async () => {
		const harness = createHarness();
		await openPanel(harness);
		harness.setChannelStatus("disconnected");
		publicAssistantActions(shallowRef(harness.session)).startConversation(
			PROMPT,
			{ mode: "plan" },
		);
		await flushPromises();
		expect(sentOfType(harness, "set_conversation_mode")).toEqual([]);
		harness.setChannelStatus("connected");
		await flushPromises();
		expect(sentOfType(harness, "set_conversation_mode")).toEqual([
			expect.objectContaining({ mode: "plan" }),
		]);
	});

	it("send the prompt as the first message, in plan mode, when asked to", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		publicAssistantActions(shallowRef(harness.session)).startConversation(
			PROMPT,
			{ mode: "plan", send: true },
		);
		await flushPromises();
		const started = sentOfType(harness, "hello").at(-1)?.conversationId;
		expect(sentOfType(harness, "set_conversation_mode")).toEqual([
			expect.objectContaining({ conversationId: started, mode: "plan" }),
		]);
		expect(sentOfType(harness, "user_message")).toEqual([
			expect.objectContaining({ content: PROMPT }),
		]);
		expect((panel.find("textarea").element as HTMLTextAreaElement).value).toBe(
			"",
		);
	});

	it("send the prompt once the stream is up, when the panel opens before it", async () => {
		const harness = createHarness();
		await openPanel(harness);
		harness.setChannelStatus("disconnected");
		publicAssistantActions(shallowRef(harness.session)).startConversation(
			PROMPT,
			{ send: true },
		);
		await flushPromises();
		expect(sentOfType(harness, "user_message")).toEqual([]);
		harness.setChannelStatus("connected");
		await flushPromises();
		expect(sentOfType(harness, "user_message")).toEqual([
			expect.objectContaining({ content: PROMPT }),
		]);
	});

	it("are unavailable without a session, and starting then does nothing", () => {
		const actions = publicAssistantActions(shallowRef(null));
		expect(actions.isAvailable).toBe(false);
		expect(() => actions.startConversation(PROMPT)).not.toThrow();
	});
});
