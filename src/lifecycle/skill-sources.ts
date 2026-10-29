import { access, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";
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

type DependencyField =
  | "dependencies"
  | "devDependencies"
  | "optionalDependencies";

const SkillDirSchema = z.string().min(1);
const LocalPathSchema = z.string().min(1);

/**
 * What the collector reads of a `package.json`. Anything of another shape
 * reads as absent: no name, no skills, no dependencies.
 */
const PackageManifestSchema = z
  .object({
    name: z.string().optional().catch(undefined),
    antelopeJs: z
      .object({ skills: z.array(z.unknown()).optional().catch(undefined) })
      .optional()
      .catch(undefined),
    dependencies: z.record(z.string(), z.unknown()).optional().catch(undefined),
    devDependencies: z
      .record(z.string(), z.unknown())
      .optional()
      .catch(undefined),
    optionalDependencies: z
      .record(z.string(), z.unknown())
      .optional()
      .catch(undefined),
  })
  .catch({});

type PackageManifest = z.infer<typeof PackageManifestSchema>;

type DependencyScanMap = Map<string, Promise<SkillSource[]>>;

type SkillSourceKey = (source: SkillSource) => string;

const PACKAGE_JSON_FILE = "package.json";
const NODE_MODULES_DIR = "node_modules";
const FALLBACK_PLUGIN_NAME = "skills";
const MODULE_DEPENDENCY_FIELDS: DependencyField[] = [
  "dependencies",
  "optionalDependencies",
];
/**
 * The project root also lends its devDependencies: a project keeps its
 * toolchain there (the core and its `ajs` CLI, the frontend renderer), and
 * those packages ship the skills about that toolchain.
 */
const PROJECT_DEPENDENCY_FIELDS: DependencyField[] = [
  ...MODULE_DEPENDENCY_FIELDS,
  "devDependencies",
];

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

function readDeclaredSkillDirs(pkg: PackageManifest): string[] {
  return (pkg.antelopeJs?.skills ?? []).flatMap((entry) => {
    const dir = SkillDirSchema.safeParse(entry);
    return dir.success ? [dir.data] : [];
  });
}

async function readPackageJson(dir: string): Promise<PackageManifest | null> {
  try {
    const raw = await readFile(path.join(dir, PACKAGE_JSON_FILE), "utf8");
    return PackageManifestSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function skillSourcesFromPackage(
  pkg: PackageManifest,
  baseDir: string,
  pluginName: string,
): SkillSource[] {
  return readDeclaredSkillDirs(pkg).map((rel) => ({
    module: pluginName,
    dir: path.resolve(baseDir, rel),
  }));
}

function listDependencyNames(
  pkg: PackageManifest,
  fields: DependencyField[],
): string[] {
  return fields.flatMap((field) => Object.keys(pkg[field] ?? {}));
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
  return skillSourcesFromPackage(
    pkg ?? {},
    depDir,
    toDependencyPluginName(pkg?.name ?? dep),
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
  dependencies: string[],
  scans: DependencyScanMap,
): Promise<SkillSource[]> {
  const nested = await Promise.all(
    dependencies.map((dep) => scanDependencyOnce(dep, localPath, scans)),
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
  const moduleName = pkg.name ?? id;
  if (!scans.has(moduleName)) {
    scans.set(moduleName, Promise.resolve([]));
  }
  const own = skillSourcesFromPackage(pkg, localPath, toPluginName(moduleName));
  const fromDependencies = await readAllDependencySkillSources(
    localPath,
    listDependencyNames(pkg, MODULE_DEPENDENCY_FIELDS),
    scans,
  );
  return [...own, ...fromDependencies];
}

/**
 * Packages the project itself depends on (the core with its framework skills,
 * the frontend renderer) are not loaded modules, and an embedded runtime's
 * host app is not a module at all, so the project root's manifest is scanned
 * too. It runs once every loaded module has registered its name in the scan
 * map, so a module the project also installs from npm is not loaded twice
 * under a second plugin name.
 */
async function readProjectSkillSources(
  projectRoot: string,
  scans: DependencyScanMap,
): Promise<SkillSource[]> {
  const pkg = await readPackageJson(projectRoot);
  if (pkg === null) return [];
  return readAllDependencySkillSources(
    projectRoot,
    listDependencyNames(pkg, PROJECT_DEPENDENCY_FIELDS),
    scans,
  );
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
async function readLoadedModulesSkillSources(
  scans: DependencyScanMap,
): Promise<SkillSource[]> {
  const ids = await ListModules();
  const infos = await Promise.all(
    ids.map((id) =>
      GetModuleInfo(id)
        .then((i) => ({ id, i }))
        .catch(() => null),
    ),
  );
  const nested = await Promise.all(
    infos.map((entry) => {
      const localPath = LocalPathSchema.safeParse(entry?.i?.localPath);
      return entry && localPath.success
        ? readModuleSkillSources(entry.id, localPath.data, scans)
        : Promise.resolve<SkillSource[]>([]);
    }),
  );
  return nested.flat();
}

async function gather(projectRoot: string): Promise<SkillSource[]> {
  const scans: DependencyScanMap = new Map();
  const fromModules = await readLoadedModulesSkillSources(scans);
  const fromProject = await readProjectSkillSources(projectRoot, scans);
  const byDir = dedupeBy(
    [...fromModules, ...fromProject],
    (source) => source.dir,
  );
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
export async function collectSkillSources(
  projectRoot: string,
): Promise<SkillSource[]> {
  try {
    return await new Promise<SkillSource[]>((resolve) => {
      const timer = setTimeout(() => resolve([]), MODULE_ROOTS_TIMEOUT_MS);
      gather(projectRoot).then(
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
