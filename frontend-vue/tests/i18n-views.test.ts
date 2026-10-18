import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/dms-ai-views-en-GB.json";
import fr from "../i18n/locales/dms-ai-views-fr-FR.json";

type Tree = Record<string, unknown>;

const ROOT = resolve(__dirname, "..");
// The page components (the skill drawer and cards among them) and the view
// helpers they share; the chat panel has its own test.
const SOURCES = ["app/components", "app/views"];
const EXCLUDED = ["ChatPanel.vue"];
const LITERAL_KEY = /["'`](dms_ai\.views\.[A-Za-z0-9_.]+[A-Za-z0-9_])["'`]/g;

/** Keys built at run time from a value, each with every value it can take. */
const DYNAMIC_FAMILIES: Record<string, readonly string[]> = {
	"dms_ai.views.skills.source": ["module", "local"],
};

function files(path: string): string[] {
	const full = join(ROOT, path);
	if (!statSync(full).isDirectory()) return [full];
	return readdirSync(full)
		.filter((entry) => !EXCLUDED.includes(entry))
		.flatMap((entry) => files(join(path, entry)));
}

function flatten(tree: Tree, prefix = ""): string[] {
	return Object.entries(tree).flatMap(([key, value]) =>
		value !== null && typeof value === "object"
			? flatten(value as Tree, `${prefix}${key}.`)
			: [`${prefix}${key}`],
	);
}

function usedKeys(): string[] {
	const source = SOURCES.flatMap(files)
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
	return [
		...new Set([...source.matchAll(LITERAL_KEY)].map((match) => match[1])),
	];
}

const dynamicKeys = Object.entries(DYNAMIC_FAMILIES).flatMap(
	([prefix, values]) => values.map((value) => `${prefix}.${value}`),
);

describe("the views' strings", () => {
	const english = new Set(flatten(en));
	const french = new Set(flatten(fr));

	it("exist in English and French alike", () => {
		expect([...english].sort()).toEqual([...french].sort());
	});

	it("cover every key the views use", () => {
		const keys = [...usedKeys(), ...dynamicKeys];
		expect(keys.length).toBeGreaterThan(0);
		expect(keys.filter((key) => !english.has(key))).toEqual([]);
	});
});
