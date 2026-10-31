import { router } from "@inertiajs/vue3";
import {
	awaitSettledBlocks,
	BLOCK_SETTLE_BUDGET_MS,
	type PageBlocks,
} from "./block-health";
import {
	HOST_NAVIGATION_COMPLETE_TYPE,
	HOST_PAGE_BLOCKS_TYPE,
} from "./constants";

interface HostNavigationCompleteMessage {
	type: typeof HOST_NAVIGATION_COMPLETE_TYPE;
	path: string;
	/** A `host_page_blocks` message for this path follows within this long. */
	blocksWithinMs: number;
}

interface HostPageBlocksMessage extends PageBlocks {
	type: typeof HOST_PAGE_BLOCKS_TYPE;
	path: string;
}

type NavigationMessage = HostNavigationCompleteMessage | HostPageBlocksMessage;

interface InstallNavigationCompleteEmitterOptions {
	send: (msg: NavigationMessage) => void;
}

/**
 * Reports each completed visit at once, then what the page's data blocks
 * showed once they settled, so the assistant learns of empty charts without
 * a screenshot.
 */
export function installNavigationCompleteEmitter(
	options: InstallNavigationCompleteEmitterOptions,
): () => void {
	let settling = new AbortController();
	let stopped = false;
	const stopNavigation = router.on("navigate", (event) => {
		const path = new URL(event.detail.page.url, window.location.origin)
			.pathname;
		settling.abort();
		settling = new AbortController();
		options.send({
			type: HOST_NAVIGATION_COMPLETE_TYPE,
			path,
			blocksWithinMs: BLOCK_SETTLE_BUDGET_MS,
		});
		void awaitSettledBlocks({
			root: document,
			signal: settling.signal,
		}).then((blocks) => {
			if (!stopped)
				options.send({ type: HOST_PAGE_BLOCKS_TYPE, path, ...blocks });
		});
	});
	return () => {
		stopped = true;
		settling.abort();
		stopNavigation();
	};
}
