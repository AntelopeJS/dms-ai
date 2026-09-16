import { access, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModuleInfo, ListModules } from "@antelopejs/interface-core/modules";
import {
  MODULE_ROOTS_TIMEOUT_MS,
  SIDECAR_LOG_PREFIX,
} from "../constants/sidecar";

export interface SkillSource {
  module: string;
  dir: string;
}

interface AntelopeJsManifest {
  skills?: unknown;
}

interface PackageManifest {
  name?: unknown;
  antelopeJs?: AntelopeJsManifest;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

type DependencyScanMap = Map<string, Promise<SkillSource[]>>;

type SkillSourceKey = (source: SkillSource) => string;

const PACKAGE_JSON_FILE = "package.json";
const NODE_MODULES_DIR = "node_modules";
const FALLBACK_PLUGIN_NAME = "skills";

function sanitizePluginName(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const trimmed = cleaned.replace(/^-+|-+$/g, "");
  return trimmed.length > 0 ? trimmed : FALLBACK_PLUGIN_NAME;
}

/**
 * Derives the `plugin:skill` namespace for a loaded module. The unscoped,
 * sanitized form is an established contract with the sidecar catalog
 * (`module:name`), so it must stay exactly as-is.
 */
function toPluginName(name: string): string {
  const unscoped = name.includes("/") ? (name.split("/").pop() ?? name) : name;
  return sanitizePluginName(unscoped);
}

/**
 * Derives the `plugin:skill` namespace for a skill-shipping dependency from
 * the full package name, scope included (`@antelopejs/interface-x` becomes
 * `antelopejs-interface-x`), so same-named packages under different scopes
 * cannot collapse onto one plugin name.
 */
function toDependencyPluginName(name: string): string {
  return sanitizePluginName(name);
}

function readDeclaredSkillDirs(pkg: unknown): string[] {
  if (pkg === null || typeof pkg !== "object") return [];
  const ajs = (pkg as PackageManifest).antelopeJs;
  const skills = ajs?.skills;
  if (!Array.isArray(skills)) return [];
  return skills.filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
}

async function readPackageJson(dir: string): Promise<unknown> {
  try {
    const raw = await readFile(path.join(dir, PACKAGE_JSON_FILE), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function skillSourcesFromPackage(
  pkg: unknown,
  baseDir: string,
  pluginName: string,
): SkillSource[] {
  return readDeclaredSkillDirs(pkg).map((rel) => ({
    module: pluginName,
    dir: path.resolve(baseDir, rel),
  }));
}

function listDependencyNames(pkg: unknown): string[] {
  if (pkg === null || typeof pkg !== "object") return [];
  const manifest = pkg as PackageManifest;
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];
}

async function toRealDir(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch {
    return dir;
  }
}

/**
 * Resolves `<dep>/package.json` with Node resolution anchored at the module
 * dir. Starting from the module's real path lets pnpm's node_modules symlinks
 * resolve into the store in common layouts; packages whose `exports` map hides
 * package.json still need the ancestor-walk fallback.
 */
function resolveDependencyDirViaRequire(
  dep: string,
  fromDir: string,
): string | null {
  try {
    const requireFrom = createRequire(path.join(fromDir, PACKAGE_JSON_FILE));
    const manifestPath = requireFrom.resolve(`${dep}/${PACKAGE_JSON_FILE}`);
    return path.dirname(manifestPath);
  } catch {
    return null;
  }
}

async function isReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fallback resolution that walks ancestor dirs looking for
 * `node_modules/<dep>`; splitting on "/" keeps scoped names intact as nested
 * path segments.
 */
async function resolveDependencyDirViaWalk(
  dep: string,
  fromDir: string,
): Promise<string | null> {
  let current = path.resolve(fromDir);
  for (;;) {
    const candidate = path.join(current, NODE_MODULES_DIR, ...dep.split("/"));
    if (await isReadable(path.join(candidate, PACKAGE_JSON_FILE))) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Returns null when the dependency cannot be resolved from `fromDir`, letting
 * the caller distinguish "not installed here" from "installed, no skills".
 */
async function readDependencySkillSources(
  dep: string,
  fromDir: string,
): Promise<SkillSource[] | null> {
  const realFromDir = await toRealDir(fromDir);
  const depDir =
    resolveDependencyDirViaRequire(dep, realFromDir) ??
    (await resolveDependencyDirViaWalk(dep, realFromDir));
  if (depDir === null) return null;
  const pkg = await readPackageJson(depDir);
  const rawName = (pkg as PackageManifest | null)?.name;
  const packageName = typeof rawName === "string" ? rawName : dep;
  return skillSourcesFromPackage(
    pkg,
    depDir,
    toDependencyPluginName(packageName),
  );
}

/**
 * Scans a dependency at most once across all modules. The in-flight promise
 * is registered synchronously, before any await, so concurrent module scans
 * inside gather()'s Promise.all reuse the first scan instead of racing past a
 * check-then-act gap and emitting duplicate sources for shared dependencies.
 * A failed resolution caches an empty result, matching the collector's
 * graceful-degradation contract.
 */
function scanDependencyOnce(
  dep: string,
  fromDir: string,
  scans: DependencyScanMap,
): Promise<SkillSource[]> {
  const inFlight = scans.get(dep);
  if (inFlight !== undefined) return inFlight;
  const scan = readDependencySkillSources(dep, fromDir).then(
    (sources) => sources ?? [],
  );
  scans.set(dep, scan);
  return scan;
}

/**
 * Interface packages (e.g. `@antelopejs/interface-database`) ship skills as
 * npm dependencies of modules rather than as loaded modules, so each module's
 * dependency list is scanned too.
 */
async function readAllDependencySkillSources(
  localPath: string,
  pkg: unknown,
  scans: DependencyScanMap,
): Promise<SkillSource[]> {
  const nested = await Promise.all(
    listDependencyNames(pkg).map((dep) =>
      scanDependencyOnce(dep, localPath, scans),
    ),
  );
  return nested.flat();
}

/**
 * Collects a loaded module's own skill sources plus those of its
 * dependencies. The module pre-registers itself in the scan map so modules
 * that depend on it do not rescan it as a dependency.
 */
async function readModuleSkillSources(
  id: string,
  localPath: string,
  scans: DependencyScanMap,
): Promise<SkillSource[]> {
  const pkg = await readPackageJson(localPath);
  if (pkg === null) return [];
  const rawName = (pkg as PackageManifest).name;
  const moduleName = typeof rawName === "string" ? rawName : id;
  if (!scans.has(moduleName)) {
    scans.set(moduleName, Promise.resolve([]));
  }
  const own = skillSourcesFromPackage(pkg, localPath, toPluginName(moduleName));
  const fromDependencies = await readAllDependencySkillSources(
    localPath,
    pkg,
    scans,
  );
  return [...own, ...fromDependencies];
}

function dedupeBy(
  sources: SkillSource[],
  key: SkillSourceKey,
  onDrop?: (source: SkillSource) => void,
): SkillSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const value = key(source);
    if (seen.has(value)) {
      onDrop?.(source);
      return false;
    }
    seen.add(value);
    return true;
  });
}

/**
 * Deduplicates by dir, then by module name: the sidecar plugin-wrapper writes
 * one plugin dir per module name, so two sources sharing a name would race on
 * the same wrapper even when they point at distinct physical copies. Dropping
 * a distinct dir is a real loss (only the first declared dir survives), so it
 * is logged instead of discarded silently.
 */
async function gather(): Promise<SkillSource[]> {
  const ids = await ListModules();
  const infos = await Promise.all(
    ids.map((id) =>
      GetModuleInfo(id)
        .then((i) => ({ id, i }))
        .catch(() => null),
    ),
  );
  const scans: DependencyScanMap = new Map();
  const nested = await Promise.all(
    infos.map((entry) =>
      entry &&
      typeof entry.i?.localPath === "string" &&
      entry.i.localPath.length > 0
        ? readModuleSkillSources(entry.id, entry.i.localPath, scans)
        : Promise.resolve([] as SkillSource[]),
    ),
  );
  const byDir = dedupeBy(nested.flat(), (source) => source.dir);
  return dedupeBy(
    byDir,
    (source) => source.module,
    (dropped) =>
      Logging.Warn(
        `${SIDECAR_LOG_PREFIX} skill dir ${dropped.dir} ignored: plugin name "${dropped.module}" already has a skill dir`,
      ),
  );
}

/**
 * Best-effort and bounded like collectModuleRoots: a registry that is not
 * answerable yet degrades to no skill sources rather than wedging module
 * start().
 */
export async function collectSkillSources(): Promise<SkillSource[]> {
  try {
    return await new Promise<SkillSource[]>((resolve) => {
      const timer = setTimeout(() => resolve([]), MODULE_ROOTS_TIMEOUT_MS);
      gather().then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        () => {
          clearTimeout(timer);
          resolve([]);
        },
      );
    });
  } catch (err) {
    Logging.Error(
      `${SIDECAR_LOG_PREFIX} failed to collect skill sources:`,
      err,
    );
    return [];
  }
}
