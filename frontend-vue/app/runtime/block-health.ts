/**
 * What the DMS data blocks (charts, KPIs, lists, tables) say about themselves.
 * Each states its kind, its layout path and what its reader sees on its root
 * element; a test harness reads the same attributes. A host that predates
 * them states nothing, and the page reads as having no data block.
 */
const BLOCK_SELECTOR = "[data-dms-block-state]";
const STATE_ATTRIBUTE = "data-dms-block-state";
const TYPE_ATTRIBUTE = "data-dms-block-type";
const PATH_ATTRIBUTE = "data-dms-block";
const UNKNOWN_TYPE = "Block";

/** How long the host waits for a page's blocks to stop loading. */
export const BLOCK_SETTLE_BUDGET_MS = 15_000;
/** How long the blocks of a page must stay unchanged before it counts as settled. */
export const BLOCK_QUIET_MS = 700;

const BLOCK_STATES = ["loading", "ok", "empty", "error"] as const;
type BlockState = (typeof BLOCK_STATES)[number];
type ReportedState = Exclude<BlockState, "ok">;

export interface BlockFact {
	path?: string;
	type: string;
	state: BlockState;
}

export interface ReportedBlock extends BlockFact {
	state: ReportedState;
}

export interface PageBlocks {
	status: "settled" | "timeout" | "superseded";
	checked: number;
	/** The blocks showing no data: empty, failed, or still loading. */
	blocks: ReportedBlock[];
}

function isBlockState(value: string | null): value is BlockState {
	return BLOCK_STATES.some((state) => state === value);
}

function isReported(block: BlockFact): block is ReportedBlock {
	return block.state !== "ok";
}

function readBlock(element: Element): BlockFact | null {
	const state = element.getAttribute(STATE_ATTRIBUTE);
	if (!isBlockState(state)) return null;
	const path = element.getAttribute(PATH_ATTRIBUTE);
	return {
		...(path === null ? {} : { path }),
		type: element.getAttribute(TYPE_ATTRIBUTE) ?? UNKNOWN_TYPE,
		state,
	};
}

/** The data blocks under `root`, in document order. */
export function readBlocks(root: ParentNode): BlockFact[] {
	return [...root.querySelectorAll(BLOCK_SELECTOR)].flatMap((element) => {
		const block = readBlock(element);
		return block === null ? [] : [block];
	});
}

function holdsBlock(node: Node): boolean {
	return (
		node instanceof Element &&
		(node.matches(BLOCK_SELECTOR) ||
			node.querySelector(BLOCK_SELECTOR) !== null)
	);
}

function changesBlocks(record: MutationRecord): boolean {
	if (record.type === "attributes") return true;
	return [...record.addedNodes, ...record.removedNodes].some(holdsBlock);
}

export interface AwaitSettledBlocksOptions {
	root: Document;
	/** Aborted when another navigation starts: the wait ends as `superseded`. */
	signal: AbortSignal;
	budgetMs?: number;
	quietMs?: number;
}

/**
 * Resolves when the blocks of the page have stopped changing for `quietMs`
 * and none is loading, or at `budgetMs` with the blocks still loading named,
 * or at once when `signal` aborts.
 */
export function awaitSettledBlocks(
	options: AwaitSettledBlocksOptions,
): Promise<PageBlocks> {
	const { root, signal } = options;
	const budgetMs = options.budgetMs ?? BLOCK_SETTLE_BUDGET_MS;
	const quietMs = options.quietMs ?? BLOCK_QUIET_MS;
	return new Promise((resolve) => {
		let quietTimer: ReturnType<typeof setTimeout> | undefined;
		const finish = (status: PageBlocks["status"]): void => {
			clearTimeout(quietTimer);
			clearTimeout(budgetTimer);
			observer.disconnect();
			signal.removeEventListener("abort", onAbort);
			const facts = readBlocks(root);
			resolve({
				status,
				checked: facts.length,
				blocks: facts.filter(isReported),
			});
		};
		const onQuiet = (): void => {
			if (readBlocks(root).every((block) => block.state !== "loading"))
				finish("settled");
		};
		const restartQuiet = (): void => {
			clearTimeout(quietTimer);
			quietTimer = setTimeout(onQuiet, quietMs);
		};
		const onAbort = (): void => finish("superseded");
		const observer = new MutationObserver((records) => {
			if (records.some(changesBlocks)) restartQuiet();
		});
		const budgetTimer = setTimeout(() => finish("timeout"), budgetMs);
		if (signal.aborted) return finish("superseded");
		signal.addEventListener("abort", onAbort);
		observer.observe(root, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: [STATE_ATTRIBUTE],
		});
		restartQuiet();
	});
}
