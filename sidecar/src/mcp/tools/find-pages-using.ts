import path from "node:path";
import { z } from "zod";
import {
  FIND_PAGES_TOOL_DESCRIPTION,
  FIND_PAGES_TOOL_NAME,
  MAX_BFS_DEPTH,
} from "../../constants/pages.js";
import type {
  ImportsScanner,
  ScanResult,
} from "../../pages/imports-scanner.js";
import type { RegistryClient } from "../../pages/registry-client.js";
import type { PageCandidate, PagesRegistryEntry } from "../../pages/types.js";
import type { CurrentPage } from "../../state/host-state.js";
import { defineTool } from "../define-tool.js";

export interface FindPagesUsingDeps {
  registry: RegistryClient;
  scanner: ImportsScanner;
  hostProjectRoot: string;
  getCurrentPage: () => CurrentPage;
}

const INPUT_SCHEMA = { filepath: z.string() } as const;

function toAbsolute(rootDir: string, filepath: string): string {
  if (path.isAbsolute(filepath)) return filepath;
  return path.resolve(rootDir, filepath);
}

function buildPageFilepathSet(
  rootDir: string,
  pages: readonly PagesRegistryEntry[],
): Map<string, PagesRegistryEntry> {
  const map = new Map<string, PagesRegistryEntry>();
  for (const page of pages) {
    if (page.filepath === undefined) continue;
    const absolute = toAbsolute(rootDir, page.filepath);
    map.set(absolute, page);
  }
  return map;
}

function buildDirectCandidate(
  page: PagesRegistryEntry,
  rootDir: string,
): PageCandidate {
  return {
    pagePath: page.path,
    pageFilepath: toAbsolute(rootDir, page.filepath ?? ""),
    distance: 0,
  };
}

function findDirectPage(
  absoluteFilepath: string,
  pageMap: Map<string, PagesRegistryEntry>,
  rootDir: string,
): PageCandidate | null {
  const page = pageMap.get(absoluteFilepath);
  if (page === undefined) return null;
  return buildDirectCandidate(page, rootDir);
}

interface BfsState {
  visited: Set<string>;
  queue: Array<{ file: string; depth: number }>;
  hits: PageCandidate[];
}

function pushImporters(
  state: BfsState,
  importers: readonly string[],
  nextDepth: number,
): void {
  for (const importer of importers) {
    if (state.visited.has(importer)) continue;
    state.visited.add(importer);
    state.queue.push({ file: importer, depth: nextDepth });
  }
}

function recordHitIfPage(
  state: BfsState,
  file: string,
  depth: number,
  pageMap: Map<string, PagesRegistryEntry>,
  rootDir: string,
): void {
  const page = pageMap.get(file);
  if (page === undefined) return;
  state.hits.push({
    pagePath: page.path,
    pageFilepath: toAbsolute(rootDir, page.filepath ?? ""),
    distance: depth,
  });
}

function bfsToPages(
  startFile: string,
  scan: ScanResult,
  pageMap: Map<string, PagesRegistryEntry>,
  rootDir: string,
): PageCandidate[] {
  const state: BfsState = {
    visited: new Set([startFile]),
    queue: [{ file: startFile, depth: 0 }],
    hits: [],
  };
  while (state.queue.length > 0) {
    const node = state.queue.shift();
    if (node === undefined) break;
    if (node.depth > 0) {
      recordHitIfPage(state, node.file, node.depth, pageMap, rootDir);
    }
    if (node.depth >= MAX_BFS_DEPTH) continue;
    const importers = scan.importersByFile.get(node.file) ?? [];
    pushImporters(state, importers, node.depth + 1);
  }
  return state.hits;
}

function comparatorFor(currentPagePath: string | undefined) {
  return (a: PageCandidate, b: PageCandidate): number => {
    const aIsCurrent =
      currentPagePath !== undefined && a.pagePath === currentPagePath;
    const bIsCurrent =
      currentPagePath !== undefined && b.pagePath === currentPagePath;
    if (aIsCurrent && !bIsCurrent) return -1;
    if (!aIsCurrent && bIsCurrent) return 1;
    return a.distance - b.distance;
  };
}

function sortCandidates(
  candidates: PageCandidate[],
  currentPagePath: string | undefined,
): PageCandidate[] {
  return [...candidates].sort(comparatorFor(currentPagePath));
}

export function computeCandidates(
  filepath: string,
  pages: readonly PagesRegistryEntry[],
  scan: ScanResult,
  rootDir: string,
  currentPage: CurrentPage,
): PageCandidate[] {
  const absolute = toAbsolute(rootDir, filepath);
  const pageMap = buildPageFilepathSet(rootDir, pages);
  const direct = findDirectPage(absolute, pageMap, rootDir);
  if (direct !== null) return sortCandidates([direct], currentPage.path);
  const hits = bfsToPages(absolute, scan, pageMap, rootDir);
  return sortCandidates(hits, currentPage.path);
}

function buildContent(candidates: PageCandidate[]): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(candidates) }],
  };
}

export function buildFindPagesUsingTool(deps: FindPagesUsingDeps) {
  return defineTool(
    FIND_PAGES_TOOL_NAME,
    FIND_PAGES_TOOL_DESCRIPTION,
    INPUT_SCHEMA,
    async ({ filepath }: { filepath: string }) => {
      const pages = await deps.registry.getRegistry();
      const scan = await deps.scanner.scan(deps.hostProjectRoot);
      const candidates = computeCandidates(
        filepath,
        pages,
        scan,
        deps.hostProjectRoot,
        deps.getCurrentPage(),
      );
      return buildContent(candidates);
    },
  );
}
