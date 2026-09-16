import {
  SUMMARY_LABELS,
  SUMMARY_MAX_DETAIL_CHARS,
  SUMMARY_TOOL_NAMES,
  SUMMARY_TRUNCATE_SUFFIX,
} from "../constants/tool-summary.js";

type SummaryBuilder = (args: unknown) => string;

function shorten(value: string): string {
  if (value.length <= SUMMARY_MAX_DETAIL_CHARS) return value;
  const sliceEnd = SUMMARY_MAX_DETAIL_CHARS - SUMMARY_TRUNCATE_SUFFIX.length;
  return `${value.slice(0, sliceEnd)}${SUMMARY_TRUNCATE_SUFFIX}`;
}

function readString(args: unknown, key: string): string {
  if (args === null || typeof args !== "object") return "";
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function buildBashSummary(args: unknown): string {
  const command = readString(args, "command");
  return `${SUMMARY_LABELS.BASH}: ${shorten(command)}`;
}

function buildPathSummary(label: string, args: unknown): string {
  const path = readString(args, "file_path");
  const display = path.length > 0 ? path : SUMMARY_LABELS.UNKNOWN_PATH;
  return `${label}: ${shorten(display)}`;
}

function buildPatternSummary(label: string, args: unknown): string {
  const pattern = readString(args, "pattern");
  return `${label}: ${shorten(pattern)}`;
}

const SUMMARY_BUILDERS: Record<string, SummaryBuilder> = {
  [SUMMARY_TOOL_NAMES.BASH]: buildBashSummary,
  [SUMMARY_TOOL_NAMES.EDIT]: (args) =>
    buildPathSummary(SUMMARY_LABELS.EDIT, args),
  [SUMMARY_TOOL_NAMES.WRITE]: (args) =>
    buildPathSummary(SUMMARY_LABELS.WRITE, args),
  [SUMMARY_TOOL_NAMES.READ]: (args) =>
    buildPathSummary(SUMMARY_LABELS.READ, args),
  [SUMMARY_TOOL_NAMES.GLOB]: (args) =>
    buildPatternSummary(SUMMARY_LABELS.GLOB, args),
  [SUMMARY_TOOL_NAMES.GREP]: (args) =>
    buildPatternSummary(SUMMARY_LABELS.GREP, args),
};

const FALLBACK_BUILDER: SummaryBuilder = () => "";

function buildDetail(toolName: string, args: unknown): string {
  const builder = SUMMARY_BUILDERS[toolName] ?? FALLBACK_BUILDER;
  return builder(args);
}

export function buildToolSummary(toolName: string, args: unknown): string {
  const detail = buildDetail(toolName, args);
  if (detail.length > 0) return detail;
  return `${SUMMARY_LABELS.GENERIC_PREFIX}: ${toolName}`;
}
