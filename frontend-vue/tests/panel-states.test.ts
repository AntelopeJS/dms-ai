// @vitest-environment jsdom
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
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
import { DIFF_REQUEST, keydown } from "./support/panel-fixtures";

beforeEach(() => {
	localStorage.setItem("dms-ai-conversation-id", CONVERSATION_ID);
});

afterEach(() => {
	unmountPanel();
	localStorage.clear();
	vi.useRealTimers();
});

describe("the panel's header and empty chat", () => {
	it("invites a first request about the page on screen", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		expect(panel.find(".cb-empty h3").text()).toBe(
			"What should we change on Sales overview?",
		);
		await buttonWithText(panel.find(".cb-suggest"), "Add a chart").trigger(
			"click",
		);
		expect((panel.find("textarea").element as HTMLTextAreaElement).value).toBe(
			"Add a chart to Sales overview",
		);
		expect(panel.find(".att.is-page").text()).toContain("sales/overview");
		expect(panel.find(".cb__status").text()).toBe("Ready · Claude Code");
	});

	it("says it works with the turn's clock, then waits for the user", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		await sendMessage(panel, "go");
		deliver(harness, {
			type: "run_progress",
			activity: "tool",
			elapsedMs: 14_000,
			idleMs: 0,
		});
		await nextTick();
		expect(panel.find(".cb__status").text()).toContain("Working · 0:14");
		deliver(harness, DIFF_REQUEST);
		await nextTick();
		expect(panel.find(".cb__status").text()).toContain(
			"Waiting for you · 1 request",
		);
	});

	it("sends leave_conversation when the panel closes", async () => {
		const harness = createHarness();
		await openPanel(harness);
		harness.session.panel.close();
		await nextTick();
		expect(sentOfType(harness, "leave_conversation")).toEqual([
			{ type: "leave_conversation", conversationId: CONVERSATION_ID },
		]);
	});

	it("stamps a message with the page unless its chip was removed", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		await panel
			.find('button[aria-label="Remove page context"]')
			.trigger("click");
		await sendMessage(panel, "explain");
		expect(sentOfType(harness, "user_message")[0]).toMatchObject({
			content: "explain",
			includePageContext: false,
		});
		expect(panel.find(".cb-user__meta").text()).toContain("sales/overview");
	});
});

describe("notices and errors", () => {
	it("shows an auto-fix turn that can be stopped", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		await sendMessage(panel, "go");
		deliver(harness, {
			type: "notice",
			notice: {
				kind: "autofix",
				attempt: 1,
				maxAttempts: 2,
				errors: ["TS2339 in top-customers.ts"],
				timestampMs: Date.now(),
			},
		});
		await nextTick();
		const notice = panel.find(".cb-notice");
		expect(notice.text()).toContain("Auto-fix turn 1 of 2.");
		await buttonWithText(notice, "Show error").trigger("click");
		expect(notice.text()).toContain("TS2339");
		await buttonWithText(notice, "Stop auto-fix").trigger("click");
		expect(sentOfType(harness, "stop_autofix")).toHaveLength(1);
	});

	it("says the agent can't run, with no fallback, and points to the settings", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		deliver(harness, {
			type: "settings_update",
			settings: {
				provider: "codex",
				mode: "normal",
				thinking: "medium",
				generationMode: "safe",
				allowLocalSkills: false,
			},
			providers: {
				claude: { available: true },
				codex: { available: false, reason: "Sign in with ChatGPT." },
			},
		});
		await nextTick();
		const notice = panel.find(".cb-provider");
		expect(notice.text()).toContain("Codex can't run.");
		expect(panel.find("textarea").attributes("disabled")).toBeDefined();
		await buttonWithText(notice, "Open settings").trigger("click");
		expect(harness.navigate).toHaveBeenCalledWith("/modules/ai/settings");
	});

	it("stops the turn with Esc", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		await sendMessage(panel, "go");
		keydown(panel.find("textarea").element, "Escape");
		expect(sentOfType(harness, "interrupt_turn")).toHaveLength(1);
	});
});

describe("the history drawer", () => {
	const LIST = {
		type: "conversation_list",
		conversations: [
			{
				id: "c-run",
				title: "Add top customers",
				createdAtMs: 1,
				updatedAtMs: Date.now(),
				messageCount: 4,
				isRunning: true,
				filesChanged: 2,
				totalTokens: 9_600,
			},
			{
				id: "c-old",
				title: "Why is order pending?",
				createdAtMs: 1,
				updatedAtMs: Date.now() - 3_600_000,
				messageCount: 2,
				filesChanged: 0,
				filesUndone: 1,
				totalTokens: 1_300,
			},
		],
	};

	it("opens with ⌘J, pins the running chat, and switches chats", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "j", metaKey: true }),
		);
		deliver(harness, LIST);
		await nextTick();
		const drawer = panel.find(".cb-drawer");
		expect(
			drawer.findAll(".cb-drawer__group").map((group) => group.text()),
		).toEqual(["Active · 1", "Today"]);
		expect(drawer.text()).toContain("9.6k tok");
		expect(drawer.text()).toContain("1 file undone");
		await buttonWithText(drawer, "Why is order pending?").trigger("click");
		expect(sentOfType(harness, "leave_conversation")[0]).toMatchObject({
			conversationId: CONVERSATION_ID,
		});
		expect(sentOfType(harness, "hello").at(-1)).toMatchObject({
			conversationId: "c-old",
		});
	});

	it("deletes after 8 seconds unless undone, and asks first for a running chat", async () => {
		vi.useFakeTimers();
		const harness = createHarness();
		const panel = await openPanel(harness);
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "j", ctrlKey: true }),
		);
		deliver(harness, LIST);
		await nextTick();
		await panel
			.findAll('button[aria-label="Delete conversation"]')[1]
			.trigger("click");
		expect(panel.find(".cb-toast").text()).toContain(
			"Deleted “Why is order pending?”",
		);
		await buttonWithText(panel.find(".cb-toast"), "Undo").trigger("click");
		await vi.advanceTimersByTimeAsync(9_000);
		expect(sentOfType(harness, "delete_conversation")).toEqual([]);
		await panel
			.findAll('button[aria-label="Delete conversation"]')[1]
			.trigger("click");
		await vi.advanceTimersByTimeAsync(9_000);
		expect(sentOfType(harness, "delete_conversation")).toEqual([
			{ type: "delete_conversation", conversationId: "c-old" },
		]);
		await panel
			.findAll('button[aria-label="Delete conversation"]')[0]
			.trigger("click");
		await buttonWithText(panel.find(".u-modal"), "Stop and delete").trigger(
			"click",
		);
		expect(sentOfType(harness, "interrupt_turn")).toEqual([
			{ type: "interrupt_turn", conversationId: "c-run" },
		]);
	});
});

describe("the dashboard can open the panel on a chat", () => {
	it("starts a new chat with a prefilled composer", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		harness.session.startConversation("Add a refund chart");
		await flushPromises();
		expect((panel.find("textarea").element as HTMLTextAreaElement).value).toBe(
			"Add a refund chart",
		);
		expect(sentOfType(harness, "hello").at(-1)?.conversationId).not.toBe(
			CONVERSATION_ID,
		);
	});

	it("opens a stored chat", async () => {
		const harness = createHarness();
		await openPanel(harness);
		harness.session.openConversation("c-42");
		await nextTick();
		expect(sentOfType(harness, "hello").at(-1)).toMatchObject({
			conversationId: "c-42",
		});
	});
});
