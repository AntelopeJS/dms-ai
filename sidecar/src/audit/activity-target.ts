import { isAbsolute } from "node:path";
import { projectRelative } from "../agent/edit-targets.js";

// Argument keys naming what a call acts on, most telling first.
const TARGET_KEYS: readonly string[] = [
  "file_path",
  "notebook_path",
  "command",
  "url",
  "pageRef",
  "ref",
  "path",
  "query",
  "page",
  "pattern",
  "name",
  "skill",
  "target",
];
const MAX_TARGET_CHARS = 200;
const ELLIPSIS = "…";

export function parseArgs(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

function shorten(text: string): string {
  const oneLine = text.replaceAll(/\s+/g, " ").trim();
  if (oneLine.length <= MAX_TARGET_CHARS) return oneLine;
  return `${oneLine.slice(0, MAX_TARGET_CHARS - 1)}${ELLIPSIS}`;
}

function displayPath(value: string, root: string): string {
  return isAbsolute(value) ? projectRelative(root, value) : value;
}

/** What a call acts on, in a few words: a file, a command, a page, a URL. */
export function activityTarget(
  _toolName: string,
  args: unknown,
  root: string,
): string {
  if (args === null || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const key = TARGET_KEYS.find(
    (k) => typeof record[k] === "string" && record[k] !== "",
  );
  if (key === undefined) return "";
  return shorten(displayPath(record[key] as string, root));
}
