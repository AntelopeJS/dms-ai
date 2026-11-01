// @vitest-environment jsdom
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
import { keydown } from "./support/panel-fixtures";

beforeEach(() => {
	localStorage.setItem("dms-ai-conversation-id", CONVERSATION_ID);
});

afterEach(() => {
	unmountPanel();
	localStorage.clear();
	vi.useRealTimers();
});

describe("questions, queue and modes", () => {
	const QUESTIONS = {
		type: "ask_question",
		requestId: "q1",
		questions: [
			{
				question: "Where should the page live?",
				header: "Placement",
				options: [
					{
						label: "Finance › Overdue invoices",
						description: "Next to Invoices",
					},
					{ label: "A tab on Invoices", description: "" },
				],
			},
			{
				question: "Default sort?",
				header: "Sort",
				options: [
					{ label: "Days overdue", description: "" },
					{ label: "Amount", description: "" },
				],
			},
		],
	};

	it("pages through questions with numbers, Other… and Skip, then keeps the answers", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		deliver(harness, QUESTIONS);
		await nextTick();
		const dock = panel.find(".cb-ask");
		expect(dock.text()).toContain("Question 1 of 2 · Placement");
		expect(dock.find(".opt-card.is-selected").text()).toContain("Suggested");
		keydown(dock.element, "3");
		await nextTick();
		await dock.find(".cb-ask__custom").setValue("Under Finance, as a tab");
		await buttonWithText(dock.find(".cb-ask__foot"), "Next").trigger("click");
		expect(dock.text()).toContain("Question 2 of 2 · Sort");
		await buttonWithText(dock, "Skip, you decide").trigger("click");
		expect(sentOfType(harness, "question_response")[0]).toEqual({
			type: "question_response",
			conversationId: CONVERSATION_ID,
			requestId: "q1",
			answers: ["Under Finance, as a tab", ""],
			skipped: [false, true],
		});
		await nextTick();
		const record = panel.find(".cb-answers");
		expect(record.text()).toContain("“Under Finance, as a tab”");
		expect(record.text()).toContain("Skipped: the assistant decides");
	});

	it("edits, reorders and clears the queue", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		deliver(harness, {
			type: "queue_state",
			items: [
				{ id: "a", content: "Sort by order count" },
				{ id: "b", content: "Limit to 3 orders" },
			],
		});
		await nextTick();
		await panel
			.find('button[aria-label="Edit queued message"]')
			.trigger("click");
		await panel.find(".cb-queued__editor").setValue("Sort by revenue");
		await buttonWithText(panel.find(".cb-queue"), "Save").trigger("click");
		keydown(panel.findAll(".cb-queued__handle")[1].element, "ArrowUp");
		await nextTick();
		expect(panel.findAll(".cb-queued__txt").map((item) => item.text())).toEqual(
			["Limit to 3 orders", "Sort by revenue"],
		);
		await buttonWithText(panel.find(".cb-queue"), "Clear").trigger("click");
		expect(
			harness.sent
				.map((msg) => msg.type)
				.filter((type) => String(type).startsWith("queue_")),
		).toEqual(["queue_update", "queue_move", "queue_clear"]);
	});

	it("switches the chat's mode and scope, and confirms Full auto with a duration", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		await buttonWithText(panel, "Plan only").trigger("click");
		await buttonWithText(panel, "Full auto…").trigger("click");
		await nextTick();
		const modal = panel.find(".u-modal");
		expect(modal.text()).toContain("Turn on Full auto?");
		await buttonWithText(modal, "30 minutes").trigger("click");
		await buttonWithText(modal, "Turn on Full auto").trigger("click");
		expect(sentOfType(harness, "set_conversation_mode")).toEqual([
			{
				type: "set_conversation_mode",
				conversationId: CONVERSATION_ID,
				mode: "plan",
			},
			{
				type: "set_conversation_mode",
				conversationId: CONVERSATION_ID,
				fullAuto: { duration: "30m" },
			},
		]);
		await nextTick();
		const banner = panel.find(".cb-banner-auto");
		expect(banner.text()).toContain("Full auto · for 30 minutes");
		await buttonWithText(banner, "Turn off").trigger("click");
		expect(sentOfType(harness, "set_conversation_mode").at(-1)).toMatchObject({
			fullAuto: null,
		});
	});

	it("runs a proposed plan in Ask first", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		await sendMessage(panel, "plan a customer health page");
		deliver(harness, {
			type: "tool_call_start",
			callId: "p1",
			toolName: "ExitPlanMode",
			args: { plan: "1. Create the page\n2. Add a query" },
		});
		deliver(harness, {
			type: "tool_call_end",
			callId: "p1",
			status: "success",
			result: "",
			outcome: "done",
		});
		deliver(harness, { type: "run_done" });
		await nextTick();
		const plan = panel.find(".cb-plan");
		expect(plan.text()).toContain("Proposed plan · 2 steps");
		await buttonWithText(plan, "Run with Ask first").trigger("click");
		expect(sentOfType(harness, "set_conversation_mode")[0]).toMatchObject({
			mode: "normal",
		});
		expect(sentOfType(harness, "user_message").at(-1)).toMatchObject({
			content: "Go ahead with the plan.",
		});
	});
});
