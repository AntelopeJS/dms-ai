import { isAbsolute, relative, resolve, sep } from "node:path";

const POSIX_SEPARATOR = "/";
const PARENT_SEGMENT = "..";

function readString(args: unknown, key: string): string | undefined {
  if (args === null || typeof args !== "object") return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringList(args: unknown, key: string): string[] {
  if (args === null || typeof args !== "object") return [];
  const value = (args as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Argument keys a file-writing tool names its target with. */
export const EDIT_PATH_KEYS: readonly string[] = ["file_path", "notebook_path"];
/** Every file a Codex patch touches, when it touches several. */
export const EDIT_PATHS_KEY = "file_paths";

/** The files an edit writes, as given by the agent (absolute or relative). */
export function editTargetPaths(args: unknown): string[] {
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
