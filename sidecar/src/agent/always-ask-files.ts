import { basename } from "node:path";
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
