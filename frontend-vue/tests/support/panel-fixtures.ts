import { CONVERSATION_ID } from "./panel-harness";

export const DIFF_REQUEST = {
	type: "permission_request",
	requestId: "r1",
	callId: "c1",
	toolName: "Edit",
	args: { file_path: "/repo/crm/customers/customer.form.ts" },
	summary: "Edit customer.form.ts",
	kind: "edit",
	alwaysAsk: false,
	preview: {
		type: "diff",
		path: "/repo/crm/customers/customer.form.ts",
		relativePath: "crm/customers/customer.form.ts",
		isNewFile: false,
		added: 1,
		removed: 1,
		hunks: [
			{
				oldStart: 42,
				newStart: 42,
				lines: [
					{ kind: "remove", text: 'label: "VAT",' },
					{ kind: "add", text: 'label: "VAT number",' },
				],
			},
		],
	},
	ruleOptions: [
		{ kind: "file", value: "crm/customers/customer.form.ts" },
		{ kind: "directory", value: "crm/customers/" },
	],
	createdAtMs: Date.now(),
	expiresAtMs: Date.now() + 252_000,
};

export const COMMAND_REQUEST = {
	...DIFF_REQUEST,
	requestId: "r2",
	callId: "c2",
	toolName: "Bash",
	args: { command: "pnpm add jsvat" },
	summary: "Run pnpm add jsvat",
	kind: "command",
	preview: {
		type: "command",
		command: "pnpm add jsvat",
		cwd: "/repo",
		effect: "adds_dependency",
		touches: ["package.json", "pnpm-lock.yaml"],
	},
	ruleOptions: [{ kind: "command", value: "pnpm add" }],
};

export const DELETE_REQUEST = {
	...DIFF_REQUEST,
	requestId: "r3",
	callId: "c3",
	toolName: "mcp__dms-ai__BuilderDeleteResource",
	args: { ref: "legacy_coupons" },
	summary: "Delete the table legacy_coupons",
	kind: "destructive",
	alwaysAsk: true,
	preview: {
		type: "destructive",
		operation: "resource · API routes",
		target: "legacy_coupons",
		consequence: "deletes_data",
		confirmText: "legacy_coupons",
		canKeepData: true,
	},
	ruleOptions: [],
};

export const CHANGE_SET = {
	id: "cs-14",
	number: 14,
	conversationId: CONVERSATION_ID,
	title: "Top customers",
	createdAtMs: Date.now(),
	agent: "claude",
	scope: "safe",
	isAutoFix: false,
	overlapped: false,
	files: [
		{
			path: "sales/overview.page.ts",
			status: "modified",
			added: 14,
			removed: 1,
		},
		{
			path: "sales/queries/top-customers.ts",
			status: "added",
			added: 22,
			removed: 0,
		},
	],
	added: 36,
	removed: 1,
	typecheck: "passed",
	state: "applied",
	approvalsNeeded: 0,
	builderOps: 2,
};

export function keydown(target: Element, key: string): void {
	target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}
