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
import { CHANGE_SET, DIFF_REQUEST } from "./support/panel-fixtures";

beforeEach(() => {
	localStorage.setItem("dms-ai-conversation-id", CONVERSATION_ID);
});

afterEach(() => {
	unmountPanel();
	localStorage.clear();
	vi.useRealTimers();
});

describe("tool rows and change sets", () => {
	it("draws each call with the lexicon's words and its state", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		await sendMessage(panel, "go");
		deliver(harness, {
			type: "tool_call_start",
			callId: "c0",
			toolName: "Read",
			args: { file_path: "/a/customer.form.ts" },
		});
		deliver(harness, {
			type: "tool_call_end",
			callId: "c0",
			status: "success",
			result: "",
			outcome: "done",
		});
		deliver(harness, {
			type: "tool_call_start",
			callId: "c9",
			toolName: "Bash",
			args: { command: "pnpm add dayjs" },
		});
		deliver(harness, {
			type: "tool_call_end",
			callId: "c9",
			status: "error",
			result: "",
			outcome: "denied",
		});
		deliver(harness, {
			type: "tool_call_start",
			callId: "c1",
			toolName: "Edit",
			args: { file_path: "/repo/crm/customers/customer.form.ts" },
		});
		deliver(harness, DIFF_REQUEST);
		await nextTick();
		const rows = panel.findAll(".cb-tool");
		expect(
			rows.map((row) => row.classes().find((name) => name.startsWith("is-"))),
		).toEqual(["is-done", "is-denied", "is-waiting"]);
		expect(rows[0].text()).toContain("Read file");
		expect(rows[0].text()).toContain("customer.form.ts");
		expect(rows[2].text()).toContain("1 of 1 · below");
		expect(panel.find(".cb-tools__head").text()).toContain("Used 3 tools");
	});

	it("shows the raw JSON of a call on demand", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		await sendMessage(panel, "go");
		deliver(harness, {
			type: "tool_call_start",
			callId: "c0",
			toolName: "mcp__dms-ai__BuilderAddBlock",
			args: { name: "Top customers", type: "TopListCard" },
		});
		deliver(harness, {
			type: "tool_call_end",
			callId: "c0",
			status: "success",
			result: "ok",
			outcome: "done",
		});
		await nextTick();
		await panel.find(".cb-tool").trigger("click");
		expect(panel.find(".cb-kv").text()).toContain("TopListCard");
		await buttonWithText(panel, "Raw JSON").trigger("click");
		expect(panel.find(".cb-raw").text()).toContain('"type": "TopListCard"');
	});

	it("ends a turn with its change set: undo, review, then redo", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		await sendMessage(panel, "go");
		deliver(harness, { type: "change_set", changeSet: CHANGE_SET });
		deliver(harness, { type: "run_done" });
		await nextTick();
		const card = panel.find(".cb-change");
		expect(card.text()).toContain("Applied · checkpoint 14");
		expect(card.text()).toContain("2 files changed · 2 Builder operations");
		expect(card.text()).toContain("new");
		await buttonWithText(card, "Review diff").trigger("click");
		expect(harness.navigate).toHaveBeenCalledWith(
			"/modules/ai/changes?set=cs-14",
		);
		await buttonWithText(card, "Undo").trigger("click");
		await flushPromises();
		expect(sentOfType(harness, "change_set_action")).toEqual([
			{
				type: "change_set_action",
				conversationId: CONVERSATION_ID,
				changeSetId: "cs-14",
				action: "undo",
			},
		]);
		deliver(harness, {
			type: "change_set",
			changeSet: { ...CHANGE_SET, state: "undone", stateChangedBy: "Camille" },
		});
		await nextTick();
		expect(panel.find(".cb-change").text()).toContain(
			"Undone · checkpoint 14 restored",
		);
		expect(panel.find(".cb-change").text()).toContain("by Camille");
		await buttonWithText(panel.find(".cb-change"), "Redo").trigger("click");
		expect(sentOfType(harness, "change_set_action").at(-1)).toMatchObject({
			action: "redo",
		});
	});

	it("asks before undoing a set later ones build on", async () => {
		const harness = createHarness();
		vi.mocked(harness.api.get).mockResolvedValueOnce({
			conflicts: [
				{
					changeSetId: "cs-15",
					number: 15,
					title: "Refund rate",
					files: ["sales/overview.page.ts"],
				},
			],
		});
		const panel = await openPanel(harness);
		deliver(harness, { type: "change_set", changeSet: CHANGE_SET });
		await nextTick();
		await buttonWithText(panel.find(".cb-change"), "Undo").trigger("click");
		await flushPromises();
		expect(panel.find(".u-modal").text()).toContain("#15 Refund rate");
		await buttonWithText(panel.find(".u-modal"), "Undo them together").trigger(
			"click",
		);
		expect(sentOfType(harness, "change_set_action")[0]).toMatchObject({
			includeLater: true,
		});
	});
});
