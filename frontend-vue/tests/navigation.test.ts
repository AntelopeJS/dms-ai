// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installCurrentPageTracker } from "../app/runtime/current-page";
import { BLOCK_SETTLE_BUDGET_MS } from "../app/runtime/block-health";
import { installNavigationCompleteEmitter } from "../app/runtime/navigation-complete";

function navigate(url: string): void {
	document.dispatchEvent(
		new CustomEvent("inertia:navigate", {
			detail: { page: { url } },
		}),
	);
}

async function flushMutations(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Inertia host navigation", () => {
	it("reports the initial pathname and completed visits, then unsubscribes", () => {
		window.history.replaceState({}, "", "/initial?tab=one#section");
		const send = vi.fn();
		const stop = installCurrentPageTracker({ send });
		expect(send).toHaveBeenLastCalledWith({
			type: "host_state_update",
			currentPage: { path: "/initial" },
		});
		navigate("/other/deep?tab=two#anchor");
		expect(send).toHaveBeenLastCalledWith({
			type: "host_state_update",
			currentPage: { path: "/other/deep" },
		});
		stop();
		navigate("/ignored");
		expect(send).toHaveBeenCalledTimes(2);
	});

	it("carries the document title and reports a title rendered after navigation", async () => {
		window.history.replaceState({}, "", "/orders");
		document.title = "Orders";
		const send = vi.fn();
		const stop = installCurrentPageTracker({ send });
		expect(send).toHaveBeenLastCalledWith({
			type: "host_state_update",
			currentPage: { path: "/orders", title: "Orders" },
		});
		navigate("/customers");
		document.title = "Customers";
		await flushMutations();
		expect(send).toHaveBeenLastCalledWith({
			type: "host_state_update",
			currentPage: { path: "/customers", title: "Customers" },
		});
		const sentCount = send.mock.calls.length;
		document.title = "Customers";
		await flushMutations();
		expect(send).toHaveBeenCalledTimes(sentCount);
		stop();
		document.title = "Ignored";
		await flushMutations();
		expect(send).toHaveBeenCalledTimes(sentCount);
		document.title = "";
	});

	it("emits completion at once after navigation, announcing the block report, and removes its event listener", () => {
		const send = vi.fn();
		const stop = installNavigationCompleteEmitter({ send });
		expect(send).not.toHaveBeenCalled();
		navigate("https://example.test/finished?view=graph#node");
		expect(send).toHaveBeenCalledExactlyOnceWith({
			type: "host_navigation_complete",
			path: "/finished",
			blocksWithinMs: BLOCK_SETTLE_BUDGET_MS,
		});
		stop();
		navigate("/ignored");
		expect(send).toHaveBeenCalledTimes(1);
	});

	describe("block report", () => {
		beforeEach(() => {
			document.body.replaceChildren();
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		function addChart(state: string): HTMLElement {
			const element = document.createElement("div");
			element.setAttribute("data-dms-block-state", state);
			element.setAttribute("data-dms-block-type", "ChartCard");
			element.setAttribute("data-dms-block", "revenue");
			document.body.append(element);
			return element;
		}

		it("follows the completion with the blocks showing no data", async () => {
			addChart("empty");
			const send = vi.fn();
			const stop = installNavigationCompleteEmitter({ send });
			navigate("/sales");
			await vi.advanceTimersByTimeAsync(BLOCK_SETTLE_BUDGET_MS);
			expect(send).toHaveBeenLastCalledWith({
				type: "host_page_blocks",
				path: "/sales",
				status: "settled",
				checked: 1,
				blocks: [{ path: "revenue", type: "ChartCard", state: "empty" }],
			});
			stop();
		});

		it("reports the first page as superseded when a second navigation starts", async () => {
			addChart("loading");
			const send = vi.fn();
			const stop = installNavigationCompleteEmitter({ send });
			navigate("/first");
			await vi.advanceTimersByTimeAsync(100);
			navigate("/second");
			await vi.advanceTimersByTimeAsync(0);
			expect(send).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "host_page_blocks",
					path: "/first",
					status: "superseded",
				}),
			);
			stop();
		});

		it("reports nothing once stopped", async () => {
			const send = vi.fn();
			const stop = installNavigationCompleteEmitter({ send });
			navigate("/sales");
			stop();
			await vi.advanceTimersByTimeAsync(BLOCK_SETTLE_BUDGET_MS);
			expect(send).toHaveBeenCalledTimes(1);
		});
	});
});
