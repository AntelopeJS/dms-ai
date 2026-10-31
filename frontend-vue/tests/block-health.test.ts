// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BLOCK_SETTLE_BUDGET_MS,
	awaitSettledBlocks,
	readBlocks,
} from "../app/runtime/block-health";

function addBlock(
	state: string,
	type: string,
	path?: string,
	parent: Element = document.body,
): HTMLElement {
	const element = document.createElement("div");
	element.setAttribute("data-dms-block-state", state);
	element.setAttribute("data-dms-block-type", type);
	if (path !== undefined) element.setAttribute("data-dms-block", path);
	parent.append(element);
	return element;
}

const never = new AbortController().signal;

describe("readBlocks", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	it("reads the state, kind and layout path each block states on its root", () => {
		addBlock("empty", "ChartCard", "revenue");
		addBlock("ok", "KpiCard");
		document.body.append(document.createElement("section"));
		expect(readBlocks(document)).toEqual([
			{ path: "revenue", type: "ChartCard", state: "empty" },
			{ type: "KpiCard", state: "ok" },
		]);
	});

	it("finds none on a host that states nothing", () => {
		document.body.append(document.createElement("section"));
		expect(readBlocks(document)).toEqual([]);
	});
});

describe("awaitSettledBlocks", () => {
	beforeEach(() => {
		document.body.replaceChildren();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("reports the blocks showing no data once the page stopped changing", async () => {
		addBlock("ok", "KpiCard", "orders");
		addBlock("empty", "ChartCard", "revenue");
		addBlock("error", "TopListCard", "top");
		const settled = awaitSettledBlocks({ root: document, signal: never });
		await vi.advanceTimersByTimeAsync(BLOCK_SETTLE_BUDGET_MS);
		await expect(settled).resolves.toEqual({
			status: "settled",
			checked: 3,
			blocks: [
				{ path: "revenue", type: "ChartCard", state: "empty" },
				{ path: "top", type: "TopListCard", state: "error" },
			],
		});
	});

	it("waits for a loading block and reports what it turned into", async () => {
		const chart = addBlock("loading", "ChartCard", "revenue");
		let result: Awaited<ReturnType<typeof awaitSettledBlocks>> | undefined;
		void awaitSettledBlocks({ root: document, signal: never }).then((value) => {
			result = value;
		});
		await vi.advanceTimersByTimeAsync(4_000);
		expect(result).toBeUndefined();
		chart.setAttribute("data-dms-block-state", "empty");
		await vi.advanceTimersByTimeAsync(4_000);
		expect(result).toEqual({
			status: "settled",
			checked: 1,
			blocks: [{ path: "revenue", type: "ChartCard", state: "empty" }],
		});
	});

	it("waits for a block that mounts after the others settled", async () => {
		addBlock("ok", "KpiCard", "orders");
		const settled = awaitSettledBlocks({ root: document, signal: never });
		await vi.advanceTimersByTimeAsync(300);
		addBlock("loading", "ChartCard", "late");
		await vi.advanceTimersByTimeAsync(BLOCK_SETTLE_BUDGET_MS);
		await expect(settled).resolves.toMatchObject({
			status: "timeout",
			checked: 2,
			blocks: [{ path: "late", type: "ChartCard", state: "loading" }],
		});
	});

	it("gives up at the budget and names the blocks still loading", async () => {
		addBlock("loading", "Chart", "slow");
		let finishedAt = -1;
		const started = Date.now();
		const settled = awaitSettledBlocks({ root: document, signal: never });
		void settled.then(() => {
			finishedAt = Date.now() - started;
		});
		await vi.advanceTimersByTimeAsync(BLOCK_SETTLE_BUDGET_MS - 1);
		expect(finishedAt).toBe(-1);
		await vi.advanceTimersByTimeAsync(1);
		await expect(settled).resolves.toEqual({
			status: "timeout",
			checked: 1,
			blocks: [{ path: "slow", type: "Chart", state: "loading" }],
		});
		expect(finishedAt).toBe(BLOCK_SETTLE_BUDGET_MS);
	});

	it("reports a page without data blocks as having none", async () => {
		const settled = awaitSettledBlocks({ root: document, signal: never });
		await vi.advanceTimersByTimeAsync(BLOCK_SETTLE_BUDGET_MS);
		await expect(settled).resolves.toEqual({
			status: "settled",
			checked: 0,
			blocks: [],
		});
	});

	it("answers at once as superseded when another navigation starts", async () => {
		addBlock("loading", "Chart", "slow");
		const controller = new AbortController();
		const settled = awaitSettledBlocks({
			root: document,
			signal: controller.signal,
		});
		await vi.advanceTimersByTimeAsync(100);
		controller.abort();
		await expect(settled).resolves.toMatchObject({ status: "superseded" });
	});
});
