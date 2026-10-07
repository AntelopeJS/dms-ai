import { describe, expect, it } from "vitest";
import {
	bareToolName,
	describeTool,
	namedArguments,
	readableToolName,
	TOOL_VERB_KEYS,
	toolVerb,
} from "../../app/chat/utils/tool-lexicon";
import { toolRowState } from "../../app/chat/utils/tool-state";
import type { ToolCallMessage } from "../../app/chat/types/conversation";
import type { PermissionRequestData } from "../../app/chat/types/permission";
import { findWaitingRequest } from "../../app/chat/utils/tool-state";

const echo = (key: string): string => key;

function tool(overrides: Partial<ToolCallMessage> = {}): ToolCallMessage {
	return {
		id: "m1",
		role: "tool",
		callId: "call-1",
		toolName: "Edit",
		args: { file_path: "/repo/crm/customer.form.ts" },
		status: "pending",
		timestampMs: 0,
		...overrides,
	};
}

describe("the tool lexicon names a call by what it does", () => {
	it("reads a file edit as a verb and the file's name", () => {
		const description = describeTool("Edit", {
			file_path: "/repo/crm/customer.form.ts",
		});
		expect(toolVerb(description, echo)).toBe("dms_ai.tools.edit_file");
		expect(description.target).toBe("customer.form.ts");
	});

	it("names a Builder block by its name and type, through the MCP prefix", () => {
		const description = describeTool("mcp__dms-ai__BuilderAddBlock", {
			page: "sales/overview",
			name: "Top customers",
			type: "TopListCard",
		});
		expect(description.verbKey).toBe("add_block");
		expect(description.target).toBe("Top customers · TopListCard");
	});

	it("shows a command, a search and a URL the way a person reads them", () => {
		expect(describeTool("Bash", { command: "pnpm add jsvat" }).target).toBe(
			"pnpm add jsvat",
		);
		expect(describeTool("Grep", { pattern: "vatNumber" }).target).toBe(
			"“vatNumber”",
		);
		expect(
			describeTool("WebFetch", { url: "https://api.vies.eu/check?x=1" }).target,
		).toBe("api.vies.eu/check");
	});

	it("covers every Builder tool and the assistant's own", () => {
		const builder = [
			"BuilderCatalog",
			"BuilderDeletePage",
			"BuilderMoveBlock",
			"BuilderDeleteResource",
			"BuilderRemoveField",
			"BuilderRemoveQuery",
			"BuilderQueryTemplates",
		];
		for (const name of [...builder, "AskUser", "Typecheck", "NavigateToPage"])
			expect(describeTool(`mcp__dms-ai__${name}`, {}).verbKey).not.toBeNull();
	});

	it("falls back to a readable form of a tool it does not know", () => {
		const description = describeTool("mcp__other__FetchInvoiceTotals", {
			name: "Q3",
		});
		expect(description.verbKey).toBeNull();
		expect(toolVerb(description, echo)).toBe("Fetch invoice totals");
		expect(description.target).toBe("Q3");
		expect(readableToolName("some_tool")).toBe("Some tool");
		expect(bareToolName("mcp__dms-ai__AskUser")).toBe("AskUser");
	});

	it("lists named arguments, values on one line", () => {
		expect(namedArguments({ page: "sales", position: { row: 2 } })).toEqual([
			{ name: "page", value: "sales" },
			{ name: "position", value: '{"row":2}' },
		]);
	});

	it("has no verb twice", () => {
		expect(new Set(TOOL_VERB_KEYS).size).toBe(TOOL_VERB_KEYS.length);
	});
});

describe("a tool row is in one of seven states", () => {
	it("takes the sidecar's outcome when there is one", () => {
		for (const outcome of [
			"done",
			"failed",
			"denied",
			"blocked",
			"stopped",
		] as const)
			expect(toolRowState(tool({ outcome, status: "error" }), true, null)).toBe(
				outcome,
			);
	});

	it("reads an older sidecar's status", () => {
		expect(toolRowState(tool({ status: "success" }), false, null)).toBe("done");
		expect(toolRowState(tool({ status: "error" }), false, null)).toBe("failed");
	});

	it("tells running, waiting and stopped apart for an open call", () => {
		const request = {
			requestId: "r1",
			callId: "call-1",
			toolName: "Edit",
		} as PermissionRequestData;
		const waiting = findWaitingRequest(tool(), [request]);
		expect(waiting).toEqual({ index: 0, total: 1, requestId: "r1" });
		expect(toolRowState(tool(), true, waiting)).toBe("waiting");
		expect(toolRowState(tool(), true, null)).toBe("running");
		expect(toolRowState(tool(), false, null)).toBe("stopped");
	});

	it("matches a request without call id by its tool", () => {
		const request = {
			requestId: "r2",
			toolName: "Edit",
		} as PermissionRequestData;
		expect(findWaitingRequest(tool(), [request])?.requestId).toBe("r2");
		expect(
			findWaitingRequest(tool({ toolName: "Bash" }), [request]),
		).toBeNull();
	});
});
