// Frontend mirror of the sidecar's tool-summary helper: turns a tool name +
// args into a short human-readable line for the collapsed cluster summary and
// the per-tool rows. Kept deliberately small — the server already sends a
// `summary` string on permission requests; this only covers streamed tool
// calls, which carry raw args instead.

const MAX_DETAIL_CHARS = 80;
const TRUNCATE_SUFFIX = "...";

const TOOL_LABELS: Record<string, string> = {
	Bash: "Run shell command",
	Edit: "Edit file",
	Write: "Write file",
	Read: "Read file",
	Glob: "Glob pattern",
	Grep: "Grep pattern",
};

const DETAIL_ARG_KEYS: Record<string, string> = {
	Bash: "command",
	Edit: "file_path",
	Write: "file_path",
	Read: "file_path",
	Glob: "pattern",
	Grep: "pattern",
};

function shorten(value: string): string {
	if (value.length <= MAX_DETAIL_CHARS) return value;
	const sliceEnd = MAX_DETAIL_CHARS - TRUNCATE_SUFFIX.length;
	return `${value.slice(0, sliceEnd)}${TRUNCATE_SUFFIX}`;
}

function readString(args: unknown, key: string): string {
	if (args === null || typeof args !== "object") return "";
	const value = (args as Record<string, unknown>)[key];
	return typeof value === "string" ? value : "";
}

function detailFor(toolName: string, args: unknown): string {
	const argKey = DETAIL_ARG_KEYS[toolName];
	if (argKey === undefined) return "";
	return shorten(readString(args, argKey));
}

export function toolSummary(toolName: string, args: unknown): string {
	const detail = detailFor(toolName, args);
	return detail.length > 0 ? detail : toolName;
}

export function toolLabel(toolName: string): string {
	return TOOL_LABELS[toolName] ?? toolName;
}
