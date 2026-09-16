import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  IMPORT_REGEX_GLOBAL,
  SCAN_EXTENSIONS,
  SCAN_IGNORE_DIRS,
} from "../constants/pages.js";

export interface ScanResult {
  importersByFile: Map<string, string[]>;
}

export interface ImportsScanner {
  scan(rootDir: string): Promise<ScanResult>;
  invalidate(): void;
}

interface ScannerCache {
  rootDir: string;
  result: ScanResult;
}

const IGNORE_DIR_SET: ReadonlySet<string> = new Set(SCAN_IGNORE_DIRS);
const EXTENSION_SET: ReadonlySet<string> = new Set(SCAN_EXTENSIONS);

function hasScannableExtension(filename: string): boolean {
  return EXTENSION_SET.has(path.extname(filename));
}

function isIgnoredDir(name: string): boolean {
  return IGNORE_DIR_SET.has(name) || name.startsWith(".");
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const stats = await stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function walkInto(current: string, files: string[]): Promise<void> {
  const entries = await listDir(current);
  for (const entry of entries) {
    const full = path.join(current, entry);
    const isDir = await isDirectory(full);
    if (isDir) {
      if (isIgnoredDir(entry)) continue;
      await walkInto(full, files);
      continue;
    }
    if (hasScannableExtension(entry)) files.push(full);
  }
}

async function walkFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  await walkInto(rootDir, files);
  return files;
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  IMPORT_REGEX_GLOBAL.lastIndex = 0;
  let match: RegExpExecArray | null = IMPORT_REGEX_GLOBAL.exec(source);
  while (match !== null) {
    const spec = match[1];
    if (spec !== undefined) specifiers.push(spec);
    match = IMPORT_REGEX_GLOBAL.exec(source);
  }
  return specifiers;
}

function isRelativeSpecifier(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("/");
}

function candidatePathsFor(resolvedBase: string): string[] {
  const direct = SCAN_EXTENSIONS.map((ext) => `${resolvedBase}${ext}`);
  const indexed = SCAN_EXTENSIONS.map((ext) =>
    path.join(resolvedBase, `index${ext}`),
  );
  return [resolvedBase, ...direct, ...indexed];
}

async function pickExistingFile(
  candidates: readonly string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      const stats = await stat(candidate);
      if (stats.isFile()) return candidate;
    } catch {}
  }
  return null;
}

async function resolveSpecifier(
  fromFile: string,
  spec: string,
): Promise<string | null> {
  if (!isRelativeSpecifier(spec)) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = candidatePathsFor(base);
  return pickExistingFile(candidates);
}

function appendImporter(
  map: Map<string, string[]>,
  target: string,
  importer: string,
): void {
  const existing = map.get(target);
  if (existing === undefined) {
    map.set(target, [importer]);
    return;
  }
  if (existing.includes(importer)) return;
  existing.push(importer);
}

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function indexFileImports(
  filePath: string,
  importersByFile: Map<string, string[]>,
): Promise<void> {
  const source = await readFileSafe(filePath);
  if (source === "") return;
  const specs = extractImportSpecifiers(source);
  for (const spec of specs) {
    const resolved = await resolveSpecifier(filePath, spec);
    if (resolved === null) continue;
    appendImporter(importersByFile, resolved, filePath);
  }
}

async function buildScanResult(rootDir: string): Promise<ScanResult> {
  const files = await walkFiles(rootDir);
  const importersByFile = new Map<string, string[]>();
  for (const file of files) {
    await indexFileImports(file, importersByFile);
  }
  return { importersByFile };
}

export function createImportsScanner(): ImportsScanner {
  let cache: ScannerCache | null = null;
  return {
    scan: async (rootDir) => {
      if (cache !== null && cache.rootDir === rootDir) return cache.result;
      const result = await buildScanResult(rootDir);
      cache = { rootDir, result };
      return result;
    },
    invalidate: () => {
      cache = null;
    },
  };
}

export async function scanImports(rootDir: string): Promise<ScanResult> {
  return buildScanResult(rootDir);
}
