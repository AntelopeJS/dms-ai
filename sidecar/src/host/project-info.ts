import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
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

const DependencyTableSchema = z.record(z.string(), z.unknown()).catch({});

const PackageManifestSchema = z.object({
  name: z.string().optional().catch(undefined),
  version: z.string().optional().catch(undefined),
  dependencies: DependencyTableSchema,
  devDependencies: DependencyTableSchema,
});

type PackageManifest = z.infer<typeof PackageManifestSchema>;

async function readPackageJson(
  filePath: string,
): Promise<PackageManifest | null> {
  try {
    const raw = await readFile(filePath, PACKAGE_JSON_ENCODING);
    return PackageManifestSchema.safeParse(JSON.parse(raw)).data ?? null;
  } catch {
    return null;
  }
}

function hasAntelopePrefix(name: string): boolean {
  return ANTELOPE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function collectDependencyNames(pkg: PackageManifest): string[] {
  return [
    ...Object.keys(pkg.dependencies),
    ...Object.keys(pkg.devDependencies),
  ];
}

function extractAntelopeModules(pkg: PackageManifest): string[] {
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

function toProjectInfo(pkg: PackageManifest): ProjectInfo {
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
