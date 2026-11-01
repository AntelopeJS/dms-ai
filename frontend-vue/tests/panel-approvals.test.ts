// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import {
	buttonWithText,
	CONVERSATION_ID,
	createHarness,
	deliver,
	openPanel,
	sentOfType,
	unmountPanel,
} from "./support/panel-harness";
import {
	COMMAND_REQUEST,
	DELETE_REQUEST,
	DIFF_REQUEST,
	keydown,
} from "./support/panel-fixtures";

beforeEach(() => {
	localStorage.setItem("dms-ai-conversation-id", CONVERSATION_ID);
});

afterEach(() => {
	unmountPanel();
	localStorage.clear();
	vi.useRealTimers();
});

describe("the approvals dock", () => {
	it("previews a diff with line numbers and allows a scope with ↵", async () => {
		// The countdown reads the clock: frozen at the request's creation, it
		// shows the full grace period however slow the run is.
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(DIFF_REQUEST.createdAtMs);
		const harness = createHarness();
		const panel = await openPanel(harness);
		deliver(harness, DIFF_REQUEST);
		deliver(harness, COMMAND_REQUEST);
		await nextTick();
		const dock = panel.find(".cb-approve");
		expect(dock.attributes("role")).toBe("alertdialog");
		expect(dock.text()).toContain("Needs your approval · 1 of 2");
		expect(dock.text()).toContain("denies in 4:12");
		expect(panel.find(".perm.is-focused .perm__title").text()).toBe(
			"Edit customer.form.ts",
		);
		expect(panel.findAll(".ln").map((row) => row.text())).toEqual([
			"@@ −42 +42 @@",
			'42−label: "VAT",',
			'42+label: "VAT number",',
		]);
		expect(dock.text()).toContain("Every edit under crm/customers/");
		await panel.findAll(".perm.is-focused .scope-opt input")[2].setValue(true);
		keydown(dock.element, "Enter");
		await nextTick();
		expect(sentOfType(harness, "permission_response")[0]).toEqual({
			type: "permission_response",
			conversationId: CONVERSATION_ID,
			requestId: "r1",
			decision: "allow_rule",
			rule: { kind: "directory", value: "crm/customers/" },
		});
		expect(panel.find(".perm.is-focused .perm__title").text()).toBe(
			"Run pnpm add jsvat",
		);
		expect(panel.find(".perm.is-focused").text()).toContain(
			"adds a dependency · package.json, pnpm-lock.yaml",
		);
	});

	it("moves with J and K, denies with N, and denies everything at once", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		deliver(harness, DIFF_REQUEST);
		deliver(harness, COMMAND_REQUEST);
		await nextTick();
		const dock = panel.find(".cb-approve");
		keydown(dock.element, "j");
		await nextTick();
		expect(dock.text()).toContain("2 of 2");
		keydown(dock.element, "k");
		await nextTick();
		expect(dock.text()).toContain("1 of 2");
		keydown(dock.element, "n");
		await nextTick();
		expect(sentOfType(harness, "permission_response")[0]).toMatchObject({
			requestId: "r1",
			decision: "deny",
		});
		deliver(harness, DIFF_REQUEST);
		await nextTick();
		await buttonWithText(
			panel.find(".cb-approve"),
			"Deny both and stop",
		).trigger("click");
		expect(sentOfType(harness, "permission_response").at(-1)).toMatchObject({
			decision: "deny_all",
		});
	});

	it("denies with the user's suggestion", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		deliver(harness, DIFF_REQUEST);
		await nextTick();
		await buttonWithText(panel, "Suggest a change").trigger("click");
		await panel
			.find(".u-textarea")
			.setValue("Use the Builder's validation instead");
		await buttonWithText(panel, "Deny and send").trigger("click");
		expect(sentOfType(harness, "permission_response")[0]).toMatchObject({
			decision: "deny",
			feedback: "Use the Builder's validation instead",
		});
	});

	it("makes a data loss typed, offers to keep the data, and never a chat-wide rule", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		deliver(harness, DELETE_REQUEST);
		await nextTick();
		const card = panel.find(".perm.is-danger");
		expect(card.text()).toContain("Data loss");
		expect(card.text()).not.toContain("this chat");
		const confirm = buttonWithText(card, "Delete");
		expect(confirm.attributes("disabled")).toBeDefined();
		await card.find(".perm__confirm input").setValue("legacy_coupons");
		expect(
			buttonWithText(card, "Delete").attributes("disabled"),
		).toBeUndefined();
		await card.find('input[type="checkbox"]').setValue(true);
		await buttonWithText(card, "Remove the code only").trigger("click");
		expect(sentOfType(harness, "permission_response")[0]).toMatchObject({
			decision: "allow_once",
			keepData: true,
		});
	});

	it("turns an expired request into a card that asks again", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		deliver(harness, DIFF_REQUEST);
		deliver(harness, {
			type: "permission_expired",
			requestId: "r1",
			toolName: "Edit",
			summary: "Edit customer.form.ts",
			expiredAtMs: Date.now(),
		});
		await nextTick();
		expect(panel.find(".cb-approve").exists()).toBe(false);
		const card = panel.find(".cb-expired");
		expect(card.text()).toContain("Edit file request expired");
		await buttonWithText(card, "Ask again").trigger("click");
		expect(sentOfType(harness, "user_message")[0].content).toContain(
			"Edit customer.form.ts",
		);
		expect(panel.find(".cb-expired").exists()).toBe(false);
	});

	it("lists the rules allowed in this chat and revokes one", async () => {
		const harness = createHarness();
		const panel = await openPanel(harness);
		deliver(harness, DIFF_REQUEST);
		deliver(harness, {
			type: "rules_state",
			rules: [
				{
					id: "rule-1",
					kind: "command",
					value: "pnpm test",
					label: "Commands starting pnpm test",
					createdAtMs: 1,
				},
			],
		});
		await nextTick();
		const rules = panel.find(".cb-approve .cb-rules");
		expect(rules.text()).toContain("Commands starting pnpm test");
		await buttonWithText(rules, "Revoke").trigger("click");
		expect(sentOfType(harness, "revoke_rule")).toEqual([
			{
				type: "revoke_rule",
				conversationId: CONVERSATION_ID,
				ruleId: "rule-1",
			},
		]);
	});
});
