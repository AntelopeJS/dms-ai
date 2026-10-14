import { readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { PermissionKind } from "../constants/audit.js";
import { BUILDER_DELETE_RESOURCE_TOOL_NAME } from "../constants/tool-kinds.js";
import type {
  CommandPreviewType,
  DestructivePreviewType,
  DiffPreviewType,
  PermissionPreviewType,
} from "../protocol/events.js";
import type { PermissionRuleType } from "../protocol/messages.js";
import {
  commandRulePrefix,
  detectDependencyChange,
} from "./command-analysis.js";
import {
  editTargetPaths,
  projectRelative,
  resolveInProject,
} from "./edit-targets.js";
import { type DiffStats, diffTexts, parseUnifiedDiff } from "./line-diff.js";
import {
  bareToolName,
  isBlockRemovalTool,
  isCommandTool,
  isDestructiveBuilderTool,
  permissionKindOf,
} from "./tool-kinds.js";

// Files above this size are not read for a preview: the card would not show
// them usefully and the read would stall the request.
const MAX_PREVIEW_FILE_BYTES = 2 * 1024 * 1024;
const FILE_ENCODING = "utf8";
const WEB_FETCH_TOOL_NAME = "WebFetch";
const CODEX_ADDED_KIND = "add";
const CODEX_DELETED_KIND = "delete";
// Argument keys of a Codex file change, set by its permission handler.
export const CODEX_CHANGE_KIND_ARG = "change_kind";
export const CODEX_CHANGE_DIFF_ARG = "diff";
// Argument keys naming the target of a Builder operation, most specific first.
const BUILDER_TARGET_KEYS: readonly string[] = [
  "pageRef",
  "ref",
  "path",
  "query",
];

/** What the bus needs to know to present, scope and gate one request. */
export interface RequestDescription {
  kind: PermissionKind;
  alwaysAsk: boolean;
  preview: PermissionPreviewType;
  ruleOptions: PermissionRuleType[];
}

export interface DescribeOptions {
  toolName: string;
  args: unknown;
  hostProjectRoot: string;
  alwaysAskDependencies: boolean;
  alwaysAskBlockRemoval: boolean;
}

function asRecord(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return {};
  }
  return args as Record<string, unknown>;
}

function readString(args: unknown, key: string): string {
  const value = asRecord(args)[key];
  return typeof value === "string" ? value : "";
}

async function readCurrent(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_PREVIEW_FILE_BYTES) return "";
    return await readFile(path, FILE_ENCODING);
  } catch {
    return null;
  }
}

function replaceOnce(
  text: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string | null {
  if (oldString.length === 0 || !text.includes(oldString)) return null;
  if (replaceAll) return text.split(oldString).join(newString);
  return text.replace(oldString, () => newString);
}

interface EditStep {
  old_string?: unknown;
  new_string?: unknown;
  replace_all?: unknown;
}

function applyEditStep(text: string | null, step: EditStep): string | null {
  if (text === null) return null;
  return replaceOnce(
    text,
    typeof step.old_string === "string" ? step.old_string : "",
    typeof step.new_string === "string" ? step.new_string : "",
    step.replace_all === true,
  );
}

function editSteps(toolName: string, args: unknown): EditStep[] {
  const record = asRecord(args);
  if (bareToolName(toolName) !== "MultiEdit") return [record as EditStep];
  return Array.isArray(record.edits) ? (record.edits as EditStep[]) : [];
}

/** The diff an Edit / MultiEdit / Write would make to `current`. */
function plannedDiff(
  toolName: string,
  args: unknown,
  current: string | null,
): DiffStats {
  const content = asRecord(args).content;
  if (typeof content === "string") return diffTexts(current ?? "", content);
  const steps = editSteps(toolName, args);
  const edited = steps.reduce(applyEditStep, current);
  if (edited !== null && current !== null) return diffTexts(current, edited);
  // The text to replace is not in the file (or there is no file yet): show the
  // replacement on its own rather than nothing.
  const fallback = steps[0] ?? {};
  return diffTexts(
    readString(fallback, "old_string"),
    readString(fallback, "new_string"),
  );
}

const CODEX_DIFF_BY_KIND: Record<
  string,
  (diff: string, current: string | null) => DiffStats
> = {
  [CODEX_ADDED_KIND]: (diff) => diffTexts("", diff),
  [CODEX_DELETED_KIND]: (diff, current) => diffTexts(current ?? diff, ""),
};

function codexDiff(args: unknown, current: string | null): DiffStats {
  const diff = readString(args, CODEX_CHANGE_DIFF_ARG);
  const kind = readString(args, CODEX_CHANGE_KIND_ARG);
  const byKind = CODEX_DIFF_BY_KIND[kind];
  return byKind === undefined ? parseUnifiedDiff(diff) : byKind(diff, current);
}

async function diffPreview(
  options: DescribeOptions,
): Promise<DiffPreviewType | null> {
  const [target] = editTargetPaths(options.args);
  if (target === undefined) return null;
  const path = resolveInProject(options.hostProjectRoot, target);
  const current = await readCurrent(path);
  const isCodex = CODEX_CHANGE_KIND_ARG in asRecord(options.args);
  const stats = isCodex
    ? codexDiff(options.args, current)
    : plannedDiff(options.toolName, options.args, current);
  const kind = readString(options.args, CODEX_CHANGE_KIND_ARG);
  return {
    type: "diff",
    path,
    relativePath: projectRelative(options.hostProjectRoot, path),
    isNewFile: current === null || kind === CODEX_ADDED_KIND,
    ...stats,
  };
}

function commandPreview(options: DescribeOptions): CommandPreviewType {
  const command = readString(options.args, "command");
  const change = detectDependencyChange(command);
  const preview: CommandPreviewType = {
    type: "command",
    command,
    cwd: options.hostProjectRoot,
  };
  if (change === null) return preview;
  return { ...preview, effect: change.effect, touches: change.touches };
}

function builderTarget(args: unknown): string {
  const key = BUILDER_TARGET_KEYS.find((k) => readString(args, k) !== "");
  return key === undefined ? "" : readString(args, key);
}

function destructivePreview(options: DescribeOptions): DestructivePreviewType {
  const operation = bareToolName(options.toolName);
  const target = builderTarget(options.args);
  const deletesData = operation === BUILDER_DELETE_RESOURCE_TOOL_NAME;
  const preview: DestructivePreviewType = {
    type: "destructive",
    operation,
    target,
    consequence: deletesData ? "deletes_data" : "removes_code",
    canKeepData: deletesData,
  };
  return deletesData ? { ...preview, confirmText: target } : preview;
}

function webPreview(options: DescribeOptions): PermissionPreviewType {
  const url = readString(options.args, "url");
  const host = hostOf(url);
  if (host === null) return genericPreview(options);
  return { type: "web", url, host };
}

function genericPreview(options: DescribeOptions): PermissionPreviewType {
  return { type: "generic", args: asRecord(options.args) };
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

type PreviewBuilder = (
  options: DescribeOptions,
) => Promise<PermissionPreviewType>;

const PREVIEW_BY_KIND: Record<PermissionKind, PreviewBuilder> = {
  edit: async (options) =>
    (await diffPreview(options)) ?? genericPreview(options),
  command: async (options) => commandPreview(options),
  web: async (options) => webPreview(options),
  destructive: async (options) => destructivePreview(options),
  builder: async (options) => genericPreview(options),
  other: async (options) => genericPreview(options),
};

function isAlwaysAsk(options: DescribeOptions): boolean {
  if (isDestructiveBuilderTool(options.toolName)) return true;
  if (options.alwaysAskBlockRemoval && isBlockRemovalTool(options.toolName)) {
    return true;
  }
  if (!options.alwaysAskDependencies || !isCommandTool(options.toolName)) {
    return false;
  }
  return detectDependencyChange(readString(options.args, "command")) !== null;
}

function editRuleOptions(options: DescribeOptions): PermissionRuleType[] {
  const targets = editTargetPaths(options.args).map((target) =>
    resolveInProject(options.hostProjectRoot, target),
  );
  const [first] = targets;
  if (first === undefined) return [];
  const relativeOf = (path: string): string =>
    projectRelative(options.hostProjectRoot, path);
  const directories = new Set(targets.map((path) => dirname(path)));
  const fileRules: PermissionRuleType[] =
    targets.length === 1 ? [{ kind: "file", value: relativeOf(first) }] : [];
  const directoryRules: PermissionRuleType[] =
    directories.size === 1
      ? [{ kind: "directory", value: relativeOf(dirname(first)) }]
      : [];
  return [...fileRules, ...directoryRules];
}

function commandRuleOptions(options: DescribeOptions): PermissionRuleType[] {
  const prefix = commandRulePrefix(readString(options.args, "command"));
  return prefix === null ? [] : [{ kind: "command", value: prefix }];
}

function webRuleOptions(options: DescribeOptions): PermissionRuleType[] {
  if (bareToolName(options.toolName) !== WEB_FETCH_TOOL_NAME) return [];
  const host = hostOf(readString(options.args, "url"));
  return host === null ? [] : [{ kind: "domain", value: host }];
}

const RULE_OPTIONS_BY_KIND: Partial<
  Record<PermissionKind, (options: DescribeOptions) => PermissionRuleType[]>
> = {
  edit: editRuleOptions,
  command: commandRuleOptions,
  web: webRuleOptions,
};

/**
 * Everything the approval card shows about one request: what kind it is, the
 * diff / command / deletion it would make, whether it must always be asked,
 * and the rule scopes it may offer (none for an always-ask request).
 */
export async function describeRequest(
  options: DescribeOptions,
): Promise<RequestDescription> {
  const kind = permissionKindOf(options.toolName);
  const alwaysAsk = isAlwaysAsk(options);
  const preview = await PREVIEW_BY_KIND[kind](options);
  const ruleOptions = alwaysAsk
    ? []
    : (RULE_OPTIONS_BY_KIND[kind]?.(options) ?? []);
  return { kind, alwaysAsk, preview, ruleOptions };
}
