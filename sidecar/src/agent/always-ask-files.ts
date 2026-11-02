import { type Dirent, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  DEPENDENCY_FILE_NAMES,
  GIT_HOOK_PATHS,
} from "../constants/permissions.js";

const ANY_TRAILING_SEGMENTS = "**";

const GIT_HOOK_PATTERNS = GIT_HOOK_PATHS.map((path) => path.split("/"));

function pathSegments(path: string): string[] {
  return path
    .toLowerCase()
    .split(/[\\/]/)
    .filter((segment) => segment.length > 0);
}

function matchesAt(
  segments: readonly string[],
  parts: readonly string[],
  start: number,
): boolean {
  return parts.every((part, index) => segments[start + index] === part);
}

function isUnder(
  segments: readonly string[],
  parts: readonly string[],
): boolean {
  return segments.some(
    (_segment, start) =>
      start + parts.length < segments.length &&
      matchesAt(segments, parts, start),
  );
}

function endsWith(
  segments: readonly string[],
  parts: readonly string[],
): boolean {
  const start = segments.length - parts.length;
  return start >= 0 && matchesAt(segments, parts, start);
}

function matchesPathEnding(
  segments: readonly string[],
  pattern: readonly string[],
): boolean {
  return pattern.at(-1) === ANY_TRAILING_SEGMENTS
    ? isUnder(segments, pattern.slice(0, -1))
    : endsWith(segments, pattern);
}

/**
 * Whether `path`, resolved, is a file that makes git run code (see
 * GIT_HOOK_PATHS). Matched anywhere on disk, case-insensitively.
 */
export function isGitHookFile(path: string): boolean {
  const segments = pathSegments(path);
  return GIT_HOOK_PATTERNS.some((pattern) =>
    matchesPathEnding(segments, pattern),
  );
}

/**
 * Whether `path`, resolved, is a dependency file by its name, anywhere on disk,
 * case-insensitively.
 */
export function isDependencyFile(path: string): boolean {
  return DEPENDENCY_FILE_NAMES.has(basename(path).toLowerCase());
}

const UNWALKED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  ".nuxt",
  ".output",
  ".next",
  ".venv",
  "venv",
  "target",
]);

function isGitHookTree(path: string): boolean {
  const segments = pathSegments(path);
  return GIT_HOOK_PATTERNS.some(
    (pattern) =>
      pattern.at(-1) === ANY_TRAILING_SEGMENTS &&
      endsWith(segments, pattern.slice(0, -1)),
  );
}

function listDirectory(directory: string): Dirent[] {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

export interface AlwaysAskPaths {
  /** Git hook files, a `.git` or `.husky` directory listed once as a whole. */
  gitHooks: string[];
  dependencies: string[];
}

/**
 * Lists the always-ask files under `roots`. Linked directories and
 * UNWALKED_DIRECTORY_NAMES are not walked.
 */
export function findAlwaysAskPaths(roots: readonly string[]): AlwaysAskPaths {
  const gitHooks = new Set<string>();
  const dependencies = new Set<string>();
  const visit = (directory: string): void => {
    for (const entry of listDirectory(directory)) {
      const path = join(directory, entry.name);
      if (isGitHookTree(path) || isGitHookFile(path)) {
        gitHooks.add(path);
      } else if (entry.isDirectory()) {
        if (!UNWALKED_DIRECTORY_NAMES.has(entry.name)) visit(path);
      } else if (isDependencyFile(path)) {
        dependencies.add(path);
      }
    }
  };
  for (const root of roots) visit(resolve(root));
  return { gitHooks: [...gitHooks], dependencies: [...dependencies] };
}
