import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  AFTER_REF_SUFFIX,
  BEFORE_REF_SUFFIX,
  BINARY_DIFF_MARKER,
  BINARY_NUMSTAT,
  CHECKPOINT_EXCLUDES,
  CHECKPOINT_REF_PREFIX,
  GIT_COMMAND,
  GIT_MAX_BUFFER_BYTES,
  GIT_PATHS_PER_CALL,
  GIT_STATUS_BY_LETTER,
  GIT_TIMEOUT_MS,
} from "../constants/checkpoints.js";
import type { ChangeSetFile } from "../state/types.js";

const execFileAsync = promisify(execFile);
const NUL = "\0";
const TAB = "\t";
const EXCLUDE_FILE_SEGMENTS = ["info", "exclude"];
// Global options on every call: pathspecs are literal file names, never globs,
// and a path is never quoted or escaped in the output.
const GIT_GLOBAL_ARGS = [
  "--literal-pathspecs",
  "-c",
  "core.quotepath=false",
  "-c",
  "core.autocrlf=false",
];
const REPO_CONFIG: ReadonlyArray<readonly [string, string]> = [
  ["gc.auto", "0"],
  ["core.autocrlf", "false"],
  ["core.quotepath", "false"],
];

export interface ShadowGitOptions {
  gitDir: string;
  workTree: string;
  // Paths under the work tree to leave out, besides CHECKPOINT_EXCLUDES.
  extraExcludes: string[];
}

export interface FileDiff {
  text: string;
  isBinary: boolean;
}

/**
 * A git repository of its own that snapshots the project's work tree. It never
 * touches the project's `.git`: every call runs with GIT_DIR, GIT_WORK_TREE and
 * GIT_INDEX_FILE pointing at the shadow repository.
 */
export interface ShadowGit {
  isInstalled(): Promise<boolean>;
  init(): Promise<void>;
  /** Stages the whole work tree and answers its tree id. */
  snapshot(): Promise<string>;
  changedFiles(before: string, after: string): Promise<ChangeSetFile[]>;
  fileDiff(before: string, after: string, file: string): Promise<FileDiff>;
  /** Puts `files` back as they are in `tree`, deleting those it lacks. */
  restore(tree: string, files: string[]): Promise<void>;
  keep(id: string, before: string, after: string): Promise<void>;
  drop(id: string): Promise<void>;
  prune(): Promise<void>;
}

function gitEnv(options: ShadowGitOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_DIR: options.gitDir,
    GIT_WORK_TREE: options.workTree,
    GIT_INDEX_FILE: path.join(options.gitDir, "index"),
  };
}

async function git(options: ShadowGitOptions, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    GIT_COMMAND,
    [...GIT_GLOBAL_ARGS, ...args],
    {
      cwd: options.workTree,
      env: gitEnv(options),
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER_BYTES,
      encoding: "utf8",
    },
  );
  return stdout;
}

async function isInstalled(): Promise<boolean> {
  try {
    await execFileAsync(GIT_COMMAND, ["--version"], {
      timeout: GIT_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

function excludeLines(options: ShadowGitOptions): string {
  const extra = options.extraExcludes.map((entry) => `/${entry}/`);
  return [...CHECKPOINT_EXCLUDES, ...extra, ""].join("\n");
}

async function init(options: ShadowGitOptions): Promise<void> {
  await mkdir(options.gitDir, { recursive: true });
  await git(options, ["init", "--quiet"]);
  for (const [key, value] of REPO_CONFIG) {
    await git(options, ["config", key, value]);
  }
  const excludeFile = path.join(options.gitDir, ...EXCLUDE_FILE_SEGMENTS);
  await mkdir(path.dirname(excludeFile), { recursive: true });
  await writeFile(excludeFile, excludeLines(options));
}

async function snapshot(options: ShadowGitOptions): Promise<string> {
  await git(options, ["add", "--all", "--ignore-errors", "--", "."]).catch(
    () => undefined,
  );
  return (await git(options, ["write-tree"])).trim();
}

function parseNumstat(output: string): Map<string, ChangeSetFile> {
  const files = new Map<string, ChangeSetFile>();
  for (const record of output.split(NUL)) {
    const [added, removed, file] = record.split(TAB);
    if (file === undefined || file.length === 0) continue;
    files.set(file, {
      path: file,
      status: "modified",
      added: added === BINARY_NUMSTAT ? 0 : Number(added),
      removed: removed === BINARY_NUMSTAT ? 0 : Number(removed),
    });
  }
  return files;
}

function applyStatuses(output: string, files: Map<string, ChangeSetFile>) {
  const parts = output.split(NUL);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const entry = files.get(parts[i + 1] as string);
    const status = GIT_STATUS_BY_LETTER[(parts[i] as string).charAt(0)];
    if (entry !== undefined && status !== undefined) entry.status = status;
  }
}

async function changedFiles(
  options: ShadowGitOptions,
  before: string,
  after: string,
): Promise<ChangeSetFile[]> {
  if (before === after) return [];
  const range = ["-r", "--no-renames", "-z", before, after];
  const numstat = await git(options, ["diff-tree", "--numstat", ...range]);
  const files = parseNumstat(numstat);
  applyStatuses(
    await git(options, ["diff-tree", "--name-status", ...range]),
    files,
  );
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function fileDiff(
  options: ShadowGitOptions,
  before: string,
  after: string,
  file: string,
): Promise<FileDiff> {
  const text = await git(options, [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-renames",
    before,
    after,
    "--",
    file,
  ]);
  return { text, isBinary: text.includes(BINARY_DIFF_MARKER) };
}

function chunks(items: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < items.length; i += GIT_PATHS_PER_CALL) {
    out.push(items.slice(i, i + GIT_PATHS_PER_CALL));
  }
  return out;
}

async function filesInTree(
  options: ShadowGitOptions,
  tree: string,
  files: string[],
): Promise<Set<string>> {
  const present = new Set<string>();
  for (const batch of chunks(files)) {
    const listed = await git(options, [
      "ls-tree",
      "-r",
      "-z",
      "--name-only",
      tree,
      "--",
      ...batch,
    ]);
    for (const name of listed.split(NUL)) if (name) present.add(name);
  }
  return present;
}

async function restore(
  options: ShadowGitOptions,
  tree: string,
  files: string[],
): Promise<void> {
  const present = await filesInTree(options, tree, files);
  for (const batch of chunks([...present])) {
    await git(options, ["checkout", tree, "--", ...batch]);
  }
  const absent = files.filter((file) => !present.has(file));
  await Promise.all(
    absent.map((file) =>
      rm(path.join(options.workTree, file), { force: true }),
    ),
  );
}

function refOf(id: string, suffix: string): string {
  return `${CHECKPOINT_REF_PREFIX}${id}${suffix}`;
}

export function createShadowGit(options: ShadowGitOptions): ShadowGit {
  return {
    isInstalled,
    init: () => init(options),
    snapshot: () => snapshot(options),
    changedFiles: (before, after) => changedFiles(options, before, after),
    fileDiff: (before, after, file) => fileDiff(options, before, after, file),
    restore: (tree, files) => restore(options, tree, files),
    async keep(id, before, after) {
      await git(options, ["update-ref", refOf(id, BEFORE_REF_SUFFIX), before]);
      await git(options, ["update-ref", refOf(id, AFTER_REF_SUFFIX), after]);
    },
    async drop(id) {
      for (const suffix of [BEFORE_REF_SUFFIX, AFTER_REF_SUFFIX]) {
        await git(options, ["update-ref", "-d", refOf(id, suffix)]).catch(
          () => undefined,
        );
      }
    },
    async prune() {
      await git(options, ["gc", "--prune=now", "--quiet"]);
    },
  };
}
