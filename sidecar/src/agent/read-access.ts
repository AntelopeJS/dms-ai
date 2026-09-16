import { isAbsolute, resolve, sep } from "node:path";
import { READ_ONLY_TOOL_PATH_KEYS } from "../constants/read-access.js";

// The roots under which read-only file tools are auto-allowed: the host project
// plus the on-disk location of every loaded module. The module paths come from
// `@antelopejs/interface-core` (GetModuleInfo.localPath) and are passed in at
// spawn — we never guess where modules live.
export function resolveReadRoots(
  hostProjectRoot: string,
  moduleRoots: readonly string[],
): string[] {
  const roots = new Set<string>([resolve(hostProjectRoot)]);
  for (const moduleRoot of moduleRoots) {
    if (moduleRoot.length > 0) roots.add(resolve(moduleRoot));
  }
  return [...roots];
}

function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

interface ReadPathArg {
  managed: boolean;
  value: string | undefined;
}

function readPathArg(
  toolName: string,
  input: Record<string, unknown>,
): ReadPathArg {
  const key = READ_ONLY_TOOL_PATH_KEYS[toolName];
  if (key === undefined) return { managed: false, value: undefined };
  const raw = input[key];
  return { managed: true, value: typeof raw === "string" ? raw : undefined };
}

// True when `toolName` is a read-only file tool whose target resolves inside one
// of the allowed roots. A missing/blank path means the tool targets the project
// cwd (e.g. Glob/Grep with no `path`), which is in-scope. `..` segments are
// collapsed by resolve(), so they can't escape a root.
export function isAutoAllowedRead(
  toolName: string,
  input: unknown,
  roots: string[],
  cwd: string,
): boolean {
  const safeInput =
    input !== null && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const { managed, value } = readPathArg(toolName, safeInput);
  if (!managed) return false;
  if (value === undefined || value.length === 0) return true;
  const abs = isAbsolute(value) ? resolve(value) : resolve(cwd, value);
  return roots.some((root) => isWithin(root, abs));
}
