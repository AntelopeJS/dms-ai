import { z } from "zod";
import { isAbsolute, relative, resolve, sep } from "node:path";

const POSIX_SEPARATOR = "/";
const PARENT_SEGMENT = "..";

/** The arguments a tool call carries: an object keyed by argument name, empty when the call sent anything else. */
export const ToolArgsSchema = z.record(z.string(), z.unknown()).catch({});
export type ToolArgs = z.infer<typeof ToolArgsSchema>;

const StringSchema = z.string();

/** The string argument `key`, empty or not; undefined when it is absent or not a string. */
export function readStringArg(args: ToolArgs, key: string): string | undefined {
  return StringSchema.safeParse(args[key]).data;
}

function readString(args: ToolArgs, key: string): string | undefined {
  const value = readStringArg(args, key);
  return value !== undefined && value.length > 0 ? value : undefined;
}

function readStringList(args: ToolArgs, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Argument keys a file-writing tool names its target with. */
const EDIT_PATH_KEYS: readonly string[] = ["file_path", "notebook_path"];
/** Every file a Codex patch touches, when it touches several. */
export const EDIT_PATHS_KEY = "file_paths";

/** The files an edit writes, as given by the agent (absolute or relative). */
export function editTargetPaths(args: ToolArgs): string[] {
  const listed = readStringList(args, EDIT_PATHS_KEY);
  if (listed.length > 0) return listed;
  const single = EDIT_PATH_KEYS.map((key) => readString(args, key)).find(
    (value) => value !== undefined,
  );
  return single === undefined ? [] : [single];
}

export function resolveInProject(root: string, target: string): string {
  return isAbsolute(target) ? resolve(target) : resolve(root, target);
}

/** `src/a.ts` for a path inside the project, the absolute path otherwise. */
export function projectRelative(root: string, absolutePath: string): string {
  const rel = relative(resolve(root), absolutePath);
  if (rel === "") return ".";
  if (rel.startsWith(PARENT_SEGMENT) || isAbsolute(rel)) return absolutePath;
  return rel.split(sep).join(POSIX_SEPARATOR);
}

export function isWithinDirectory(directory: string, target: string): boolean {
  return target === directory || target.startsWith(`${directory}${sep}`);
}
