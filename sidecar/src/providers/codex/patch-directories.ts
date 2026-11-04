import { lstat, mkdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import {
  isWithinDirectory,
  resolveInProject,
} from "../../agent/edit-targets.js";
import type { CodexFileChange } from "./adapter.js";
import { isSecretFileName } from "./secret-file-globs.js";

export interface PatchRoots {
  hostProjectRoot: string;
  /** The project and module roots, resolved. */
  roots: readonly string[];
}

const ADD_KIND = "add";

function createdFiles(changes: readonly CodexFileChange[]): string[] {
  return changes.flatMap((change) => {
    if (change.kind === ADD_KIND) return [change.path];
    return change.movePath === undefined ? [] : [change.movePath];
  });
}

async function makeDirectory(directory: string): Promise<boolean> {
  try {
    await mkdir(directory);
    return true;
  } catch {
    return false;
  }
}

async function isRealDirectory(target: string): Promise<boolean | undefined> {
  try {
    return (await lstat(target)).isDirectory();
  } catch {
    return undefined;
  }
}

async function createParents(root: string, file: string): Promise<void> {
  const segments = relative(root, file).split(sep);
  if (segments.some(isSecretFileName)) return;
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    const existing = await isRealDirectory(current);
    if (existing === false) return;
    if (existing === undefined && !(await makeDirectory(current))) return;
  }
}

/**
 * Creates the missing parent directories of every file an approved patch adds
 * or moves to: Codex applies the patch inside the read-only sandbox, where it
 * cannot create them itself. Only directories under a root, never through a
 * symlink or a file, and none for a path that names a secret file.
 */
export async function createPatchDirectories(
  changes: readonly CodexFileChange[],
  { hostProjectRoot, roots }: PatchRoots,
): Promise<void> {
  const deepestFirst = [...roots].sort((a, b) => b.length - a.length);
  for (const created of createdFiles(changes)) {
    const file = resolveInProject(hostProjectRoot, created);
    const root = deepestFirst.find((candidate) =>
      isWithinDirectory(candidate, dirname(file)),
    );
    if (root !== undefined) await createParents(root, file);
  }
}
