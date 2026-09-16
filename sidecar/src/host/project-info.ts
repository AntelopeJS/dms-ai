import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ANTELOPE_PREFIXES,
  PACKAGE_JSON_ENCODING,
  PACKAGE_JSON_FILENAME,
  PROJECT_INFO_FALLBACK,
} from "../constants/project.js";

export interface ProjectInfo {
  name: string;
  version: string;
  antelopeModules: string[];
}

interface PackageJsonShape {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readPackageJson(
  filePath: string,
): Promise<PackageJsonShape | null> {
  try {
    const raw = await readFile(filePath, PACKAGE_JSON_ENCODING);
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    return parsed as PackageJsonShape;
  } catch {
    return null;
  }
}

function hasAntelopePrefix(name: string): boolean {
  return ANTELOPE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function collectDependencyNames(pkg: PackageJsonShape): string[] {
  const deps = pkg.dependencies ?? {};
  const devDeps = pkg.devDependencies ?? {};
  return [...Object.keys(deps), ...Object.keys(devDeps)];
}

function extractAntelopeModules(pkg: PackageJsonShape): string[] {
  const all = collectDependencyNames(pkg);
  const matching = all.filter(hasAntelopePrefix);
  const unique = Array.from(new Set(matching));
  return unique.sort();
}

function buildFallback(): ProjectInfo {
  return {
    name: PROJECT_INFO_FALLBACK.name,
    version: PROJECT_INFO_FALLBACK.version,
    antelopeModules: [...PROJECT_INFO_FALLBACK.antelopeModules],
  };
}

function toProjectInfo(pkg: PackageJsonShape): ProjectInfo {
  return {
    name: pkg.name ?? PROJECT_INFO_FALLBACK.name,
    version: pkg.version ?? PROJECT_INFO_FALLBACK.version,
    antelopeModules: extractAntelopeModules(pkg),
  };
}

export async function readProjectInfo(
  hostProjectRoot: string,
): Promise<ProjectInfo> {
  const filePath = join(hostProjectRoot, PACKAGE_JSON_FILENAME);
  const pkg = await readPackageJson(filePath);
  if (pkg === null) return buildFallback();
  return toProjectInfo(pkg);
}
