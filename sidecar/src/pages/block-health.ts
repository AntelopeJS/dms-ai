import type { PageBlocksReport } from "../server/navigation-completer.js";

/** A data block, named by its position in the page layout and its kind. */
export interface BlockRef {
  path?: string;
  type: string;
}

/**
 * What the dashboard's data blocks showed once the page stopped changing,
 * as the `NavigateToPage` result carries it.
 */
export interface BlockHealth {
  checked: number;
  /** False when the host stopped waiting, or the page changed meanwhile. */
  settled: boolean;
  empty: BlockRef[];
  error: BlockRef[];
  loading: BlockRef[];
}

const PATH_SEPARATOR = ".";

function isDescendantOf(path: string, ancestor: string): boolean {
  return path.startsWith(`${ancestor}${PATH_SEPARATOR}`);
}

/**
 * Lists the blocks of one state, leaving out a block inside another listed
 * as empty or failed: the card around a chart already says so.
 */
function withoutNested(
  blocks: PageBlocksReport["blocks"],
  state: "empty" | "error" | "loading",
): BlockRef[] {
  const reasons = blocks.filter(
    (block) => block.state === "empty" || block.state === "error",
  );
  return blocks
    .filter((block) => block.state === state)
    .filter(
      (block) =>
        block.path === undefined ||
        !reasons.some(
          (other) =>
            other.path !== undefined &&
            other.path !== block.path &&
            isDescendantOf(block.path ?? "", other.path),
        ),
    )
    .map(({ path, type }) => (path === undefined ? { type } : { path, type }));
}

/** Null when the page holds no data block, which has nothing to report. */
export function summarizeBlocks(report: PageBlocksReport): BlockHealth | null {
  if (report.checked === 0) return null;
  return {
    checked: report.checked,
    settled: report.status === "settled",
    empty: withoutNested(report.blocks, "empty"),
    error: withoutNested(report.blocks, "error"),
    loading: withoutNested(report.blocks, "loading"),
  };
}

function name(block: BlockRef): string {
  return block.path === undefined
    ? block.type
    : `${block.path} (${block.type})`;
}

function list(blocks: BlockRef[]): string {
  return blocks.map(name).join(", ");
}

const EMPTY_HINT =
  "An empty chart, KPI or list means its query or its binding is wrong (an empty table can be legitimate).";
const FIX_HINT =
  "Fix them, or say why they are empty, before reporting the page as done.";

/** One paragraph for the agent: what rendered, what did not, what to do. */
export function describeBlocks(health: BlockHealth): string {
  const problems = health.empty.length + health.error.length;
  const parts: string[] = [];
  if (problems === 0 && health.loading.length === 0) {
    return `Block check: all ${health.checked} data blocks rendered with data.`;
  }
  if (problems > 0) {
    parts.push(
      `Block check: ${problems} of ${health.checked} data blocks show no data.`,
    );
  } else {
    parts.push(`Block check: ${health.checked} data blocks on the page.`);
  }
  if (health.empty.length > 0) parts.push(`Empty: ${list(health.empty)}.`);
  if (health.error.length > 0) {
    parts.push(`Failed to load: ${list(health.error)}.`);
  }
  if (health.loading.length > 0) {
    parts.push(`Still loading when the check ended: ${list(health.loading)}.`);
  }
  if (problems > 0) parts.push(EMPTY_HINT, FIX_HINT);
  return parts.join(" ");
}
