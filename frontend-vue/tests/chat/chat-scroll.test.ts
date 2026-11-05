// @vitest-environment jsdom
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import {
	CONVERSATION_ID,
	createHarness,
	deliver,
	type Harness,
	openPanel,
	sendMessage,
	unmountPanel,
} from "../support/panel-harness";
import {
	type FakeScroller,
	fakeScroller,
	settleLayout,
} from "../support/fake-layout";

const BOTTOM_TOLERANCE_PX = 4;

interface OpenChat {
	harness: Harness;
	panel: VueWrapper;
	scroller: FakeScroller;
}

function transcript(rows: number) {
	return Array.from({ length: rows }, (_, index) => ({
		role: index % 2 === 0 ? "user" : "assistant",
		content: `message ${index}`,
		timestampMs: 1_700_000_000_000 + index,
	}));
}

/** One browser frame: Vue renders, then layout is reported. */
async function frame(): Promise<void> {
	await nextTick();
	await flushPromises();
	settleLayout();
}

async function openChat(rows = 30): Promise<OpenChat> {
	const harness = createHarness();
	const panel = await openPanel(harness);
	const scroller = fakeScroller(
		panel.find<HTMLElement>(".chat-view-body").element,
	);
	deliver(harness, {
		type: "conversation_snapshot",
		messages: transcript(rows),
	});
	await frame();
	return { harness, panel, scroller };
}

async function growTranscript(chat: OpenChat, rows: number): Promise<void> {
	deliver(chat.harness, {
		type: "conversation_snapshot",
		messages: transcript(rows),
	});
	await frame();
}

beforeEach(() => {
	localStorage.setItem("dms-ai-conversation-id", CONVERSATION_ID);
});

afterEach(() => {
	unmountPanel();
	localStorage.clear();
});

describe("the chat follows the conversation", () => {
	it("shows the end of a chat opened from its snapshot", async () => {
		const { scroller } = await openChat(60);
		expect(scroller.distanceFromBottom()).toBeLessThanOrEqual(
			BOTTOM_TOLERANCE_PX,
		);
	});

	it("stays at the bottom when the view loses height without any message arriving", async () => {
		const { scroller } = await openChat();
		scroller.viewportPx -= 250;
		await frame();
		expect(scroller.distanceFromBottom()).toBeLessThanOrEqual(
			BOTTOM_TOLERANCE_PX,
		);
	});

	it("stays at the bottom when content grows without any message arriving", async () => {
		const { scroller } = await openChat();
		scroller.extraContentPx += 600;
		await frame();
		expect(scroller.distanceFromBottom()).toBeLessThanOrEqual(
			BOTTOM_TOLERANCE_PX,
		);
	});

	it("stays at the bottom through one message taller than the old 80px margin", async () => {
		const { scroller, harness } = await openChat();
		deliver(harness, { type: "assistant_message_chunk", text: "answer" });
		scroller.extraContentPx += 900;
		await frame();
		expect(scroller.distanceFromBottom()).toBeLessThanOrEqual(
			BOTTOM_TOLERANCE_PX,
		);
	});

	it("does not pull the person back down once they scroll up", async () => {
		const chat = await openChat();
		chat.scroller.scrollTo(500);
		await growTranscript(chat, 40);
		chat.scroller.extraContentPx += 300;
		await frame();
		expect(
			chat.panel.find<HTMLElement>(".chat-view-body").element.scrollTop,
		).toBe(500);
	});

	it("jumps to the bottom when a message is sent from far up", async () => {
		const chat = await openChat();
		chat.scroller.scrollTo(200);
		await sendMessage(chat.panel, "and now this");
		await frame();
		expect(chat.scroller.distanceFromBottom()).toBeLessThanOrEqual(
			BOTTOM_TOLERANCE_PX,
		);
	});

	it("follows again once the person scrolls back to the bottom", async () => {
		const chat = await openChat();
		chat.scroller.scrollTo(500);
		const bottom = chat.scroller.viewportPx;
		chat.scroller.scrollTo(
			chat.panel.find<HTMLElement>(".chat-view-body").element.scrollHeight -
				bottom,
		);
		await growTranscript(chat, 40);
		expect(chat.scroller.distanceFromBottom()).toBeLessThanOrEqual(
			BOTTOM_TOLERANCE_PX,
		);
	});

	it("stops following on an upward scroll that carries no input", async () => {
		const chat = await openChat();
		chat.scroller.scrollTo(500);
		await growTranscript(chat, 40);
		chat.scroller.extraContentPx += 300;
		await frame();
		expect(
			chat.panel.find<HTMLElement>(".chat-view-body").element.scrollTop,
		).toBe(500);
	});

	it("keeps following when content above the view collapses and scroll anchoring moves the view up", async () => {
		const chat = await openChat();
		chat.scroller.extraContentPx += 800;
		await frame();
		chat.scroller.collapseAbove(600);
		await frame();
		await frame();
		expect(chat.scroller.distanceFromBottom()).toBeLessThanOrEqual(
			BOTTOM_TOLERANCE_PX,
		);
		chat.scroller.extraContentPx += 400;
		await frame();
		expect(chat.scroller.distanceFromBottom()).toBeLessThanOrEqual(
			BOTTOM_TOLERANCE_PX,
		);
	});

	it("keeps following when a collapse above the view comes with growth below it", async () => {
		const chat = await openChat();
		chat.scroller.extraContentPx += 800;
		await frame();
		chat.scroller.collapseAbove(600);
		chat.scroller.extraContentPx += 700;
		await frame();
		await frame();
		expect(chat.scroller.distanceFromBottom()).toBeLessThanOrEqual(
			BOTTOM_TOLERANCE_PX,
		);
	});

	it("keeps following when the view gains height and the browser clamps the scroll", async () => {
		const chat = await openChat();
		chat.scroller.viewportPx += 250;
		await frame();
		await frame();
		chat.scroller.extraContentPx += 500;
		await frame();
		expect(chat.scroller.distanceFromBottom()).toBeLessThanOrEqual(
			BOTTOM_TOLERANCE_PX,
		);
	});

	it("keeps following after the content shrinks under the view", async () => {
		const chat = await openChat(60);
		await growTranscript(chat, 20);
		await growTranscript(chat, 30);
		expect(chat.scroller.distanceFromBottom()).toBeLessThanOrEqual(
			BOTTOM_TOLERANCE_PX,
		);
	});

	it("ends at the bottom for a chat started from outside that sends its prompt", async () => {
		const chat = await openChat();
		chat.scroller.scrollTo(200);
		chat.harness.session.startConversation("build me a page", undefined, true);
		await frame();
		await frame();
		expect(chat.scroller.distanceFromBottom()).toBeLessThanOrEqual(
			BOTTOM_TOLERANCE_PX,
		);
	});

	it("opens another chat at its bottom, even after scrolling up in this one", async () => {
		const chat = await openChat();
		chat.scroller.scrollTo(200);
		chat.harness.session.openConversation("conv-other");
		await frame();
		deliver(chat.harness, {
			conversationId: "conv-other",
			type: "conversation_snapshot",
			messages: transcript(50),
		});
		await frame();
		expect(chat.scroller.distanceFromBottom()).toBeLessThanOrEqual(
			BOTTOM_TOLERANCE_PX,
		);
	});

	it("keeps following in a shorter chat opened from the bottom of a long one", async () => {
		const chat = await openChat(60);
		chat.harness.session.openConversation("conv-other");
		await frame();
		deliver(chat.harness, {
			conversationId: "conv-other",
			type: "conversation_snapshot",
			messages: transcript(8),
		});
		await frame();
		await frame();
		chat.scroller.extraContentPx += 500;
		await frame();
		expect(chat.scroller.distanceFromBottom()).toBeLessThanOrEqual(
			BOTTOM_TOLERANCE_PX,
		);
	});
});
