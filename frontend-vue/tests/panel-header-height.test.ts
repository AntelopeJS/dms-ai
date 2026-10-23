import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom does not lay out, so these read the stylesheets: each panel header must
// take its height from the DMS navbar's variable, or their borders drift apart.
const HEADER_RULES = [
	{ file: "../app/chat/components/PanelHeader.vue", selector: ".cb__head" },
	{
		file: "../app/chat/components/ConversationDrawer.vue",
		selector: ".cb-drawer__head",
	},
];

function ruleBody(source: string, selector: string): string {
	const start = source.indexOf(`${selector} {`);
	expect(start, `${selector} rule`).toBeGreaterThanOrEqual(0);
	return source.slice(start, source.indexOf("}", start));
}

describe("panel header height", () => {
	it.each(HEADER_RULES)("$selector uses the DMS header height", (rule) => {
		const source = readFileSync(resolve(__dirname, rule.file), "utf8");

		expect(ruleBody(source, rule.selector)).toMatch(
			/\bheight: var\(--ui-header-height\);/,
		);
	});

	it("centres the status overlay close button in that height", () => {
		const source = readFileSync(
			resolve(__dirname, "../app/components/ChatPanel.vue"),
			"utf8",
		);

		expect(ruleBody(source, ".dms-ai-panel-close")).toContain(
			"var(--ui-header-height)",
		);
	});
});
