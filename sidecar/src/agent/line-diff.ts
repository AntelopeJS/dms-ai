import type { DiffHunkType, DiffLineType } from "../protocol/events.js";

// Lines of unchanged context kept around each change, as `git diff` does.
export const DIFF_CONTEXT_LINES = 3;
// Above this many cells the line-matching table is not worth building: the
// changed region is shown as a whole removal plus a whole addition instead.
const MAX_MATCH_CELLS = 2_000_000;
const LINE_BREAK = /\r?\n/;
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const NO_NEWLINE_MARKER = "\\";
const FILE_HEADER_PREFIX = "diff --git";

const LINE_KIND_BY_PREFIX: Record<string, DiffLineType["kind"]> = {
  " ": "context",
  "+": "add",
  "-": "remove",
};

export interface DiffStats {
  hunks: DiffHunkType[];
  added: number;
  removed: number;
}

interface LineCursor {
  oldLine: number;
  newLine: number;
}

/** Splits text into lines, without the empty one a trailing newline makes. */
export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(LINE_BREAK);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function commonPrefixLength(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLength(a: string[], b: string[], prefix: number): number {
  let i = 0;
  while (
    i < a.length - prefix &&
    i < b.length - prefix &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  ) {
    i++;
  }
  return i;
}

function buildMatchTable(a: string[], b: string[]): Uint32Array[] {
  const table = Array.from(
    { length: a.length + 1 },
    () => new Uint32Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    const row = table[i] as Uint32Array;
    const next = table[i + 1] as Uint32Array;
    for (let j = b.length - 1; j >= 0; j--) {
      row[j] =
        a[i] === b[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number);
    }
  }
  return table;
}

type LineKind = DiffLineType["kind"];

function middleKinds(a: string[], b: string[]): LineKind[] {
  if (a.length * b.length > MAX_MATCH_CELLS) {
    return [
      ...a.map((): LineKind => "remove"),
      ...b.map((): LineKind => "add"),
    ];
  }
  const table = buildMatchTable(a, b);
  const kinds: LineKind[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      kinds.push("context");
      i++;
      j++;
    } else if (
      j >= b.length ||
      (i < a.length && (table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0))
    ) {
      kinds.push("remove");
      i++;
    } else {
      kinds.push("add");
      j++;
    }
  }
  return kinds;
}

function toLines(kinds: LineKind[], a: string[], b: string[]): DiffLineType[] {
  const cursor: LineCursor = { oldLine: 1, newLine: 1 };
  return kinds.map((kind) => {
    const line: DiffLineType = { kind, text: "" };
    if (kind !== "add") {
      line.oldLine = cursor.oldLine;
      line.text = a[cursor.oldLine - 1] ?? "";
      cursor.oldLine++;
    }
    if (kind !== "remove") {
      line.newLine = cursor.newLine;
      line.text = b[cursor.newLine - 1] ?? "";
      cursor.newLine++;
    }
    return line;
  });
}

/** Every line of both texts, each marked unchanged, added or removed. */
export function diffLines(oldText: string, newText: string): DiffLineType[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const prefix = commonPrefixLength(a, b);
  const suffix = commonSuffixLength(a, b, prefix);
  const kinds: LineKind[] = [
    ...Array.from({ length: prefix }, (): LineKind => "context"),
    ...middleKinds(
      a.slice(prefix, a.length - suffix),
      b.slice(prefix, b.length - suffix),
    ),
    ...Array.from({ length: suffix }, (): LineKind => "context"),
  ];
  return toLines(kinds, a, b);
}

function isChange(line: DiffLineType): boolean {
  return line.kind !== "context";
}

function keptIndexes(lines: DiffLineType[], context: number): boolean[] {
  const kept = lines.map(() => false);
  lines.forEach((line, index) => {
    if (!isChange(line)) return;
    const from = Math.max(0, index - context);
    const to = Math.min(lines.length - 1, index + context);
    for (let i = from; i <= to; i++) kept[i] = true;
  });
  return kept;
}

function startHunk(line: DiffLineType, cursor: LineCursor): DiffHunkType {
  return {
    oldStart: line.oldLine ?? cursor.oldLine,
    newStart: line.newLine ?? cursor.newLine,
    lines: [],
  };
}

function advance(cursor: LineCursor, line: DiffLineType): void {
  if (line.oldLine !== undefined) cursor.oldLine = line.oldLine + 1;
  if (line.newLine !== undefined) cursor.newLine = line.newLine + 1;
}

/** Groups a full line diff into hunks with `context` lines around changes. */
export function groupHunks(
  lines: DiffLineType[],
  context = DIFF_CONTEXT_LINES,
): DiffHunkType[] {
  const kept = keptIndexes(lines, context);
  const hunks: DiffHunkType[] = [];
  const cursor: LineCursor = { oldLine: 1, newLine: 1 };
  let current: DiffHunkType | null = null;
  lines.forEach((line, index) => {
    if (!kept[index]) {
      current = null;
    } else {
      current ??= startHunk(line, cursor);
      if (current.lines.length === 0) hunks.push(current);
      current.lines.push(line);
    }
    advance(cursor, line);
  });
  return hunks;
}

function countKind(hunks: DiffHunkType[], kind: LineKind): number {
  return hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((l) => l.kind === kind).length,
    0,
  );
}

function withStats(hunks: DiffHunkType[]): DiffStats {
  return {
    hunks,
    added: countKind(hunks, "add"),
    removed: countKind(hunks, "remove"),
  };
}

/** Unified hunks with line numbers between two versions of a file. */
export function diffTexts(oldText: string, newText: string): DiffStats {
  return withStats(groupHunks(diffLines(oldText, newText)));
}

function parsedLine(raw: string, cursor: LineCursor): DiffLineType | null {
  const kind = LINE_KIND_BY_PREFIX[raw.charAt(0)];
  if (kind === undefined) return null;
  const line: DiffLineType = { kind, text: raw.slice(1) };
  if (kind !== "add") line.oldLine = cursor.oldLine++;
  if (kind !== "remove") line.newLine = cursor.newLine++;
  return line;
}

function openHunk(match: RegExpExecArray, cursor: LineCursor): DiffHunkType {
  cursor.oldLine = Number(match[1]);
  cursor.newLine = Number(match[2]);
  return { oldStart: cursor.oldLine, newStart: cursor.newLine, lines: [] };
}

/** Reads the hunks of a unified diff (git's or Codex's), headers ignored. */
export function parseUnifiedDiff(text: string): DiffStats {
  const hunks: DiffHunkType[] = [];
  const cursor: LineCursor = { oldLine: 1, newLine: 1 };
  let current: DiffHunkType | null = null;
  for (const raw of text.split(LINE_BREAK)) {
    if (raw.startsWith(FILE_HEADER_PREFIX)) current = null;
    const header = HUNK_HEADER.exec(raw);
    if (header !== null) {
      current = openHunk(header, cursor);
      hunks.push(current);
      continue;
    }
    if (current === null || raw.startsWith(NO_NEWLINE_MARKER)) continue;
    const line = parsedLine(raw, cursor);
    if (line !== null) current.lines.push(line);
  }
  return withStats(hunks);
}
