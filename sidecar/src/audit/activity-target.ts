import { isAbsolute } from "node:path";
import {
  projectRelative,
  readStringArg,
  type ToolArgs,
} from "../agent/edit-targets.js";
import { type JsonValue, JsonValueSchema } from "../protocol/json.js";

/** Argument keys naming what a call acts on, most telling first. */
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

export function parseArgs(content: string): JsonValue {
  try {
    return JsonValueSchema.parse(JSON.parse(content));
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
  args: ToolArgs,
  root: string,
): string {
  for (const key of TARGET_KEYS) {
    const value = readStringArg(args, key);
    if (value !== undefined && value !== "") {
      return shorten(displayPath(value, root));
    }
  }
  return "";
}
