import { z } from "zod";
import {
  collectSkillPackages,
  type ModuleRef,
  type SkillPackage,
} from "@antelopejs/agent-skills";
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

const LocalPathSchema = z.string().min(1);

type SkillSourceKey = (source: SkillSource) => string;

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

function pluginNameOf(skillPackage: SkillPackage): string {
  return skillPackage.kind === "module"
    ? toPluginName(skillPackage.name)
    : toDependencyPluginName(skillPackage.name);
}

function toSkillSources(skillPackages: SkillPackage[]): SkillSource[] {
  return skillPackages.flatMap((skillPackage) =>
    skillPackage.skillDirs.map((dir) => ({
      module: pluginNameOf(skillPackage),
      dir,
    })),
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

async function listLoadedModules(): Promise<ModuleRef[]> {
  const ids = await ListModules();
  const read = await Promise.all(
    ids.map((id) =>
      GetModuleInfo(id)
        .then((info): ModuleRef | null => {
          const localPath = LocalPathSchema.safeParse(info.localPath);
          return localPath.success ? { dir: localPath.data, id } : null;
        })
        .catch(() => null),
    ),
  );
  return read.filter((ref) => ref !== null);
}

/**
 * Which packages ship skills, and which copy of each wins, is decided by
 * `@antelopejs/agent-skills`, the code the Claude Code and Codex plugin runs
 * too. This keeps what the assistant owns: the plugin names, the one source
 * per skill dir, and one skill dir per plugin name. The sidecar plugin-wrapper
 * writes one plugin dir per module name, so two sources sharing a name would
 * race on the same wrapper even when they point at distinct physical copies.
 * Dropping a distinct dir is a real loss (only the first declared dir
 * survives), so it is logged instead of discarded silently.
 */
async function gather(projectRoot: string): Promise<SkillSource[]> {
  const skillPackages = collectSkillPackages({
    modules: await listLoadedModules(),
    project: projectRoot,
    onWarning: (message) => Logging.Warn(`${SIDECAR_LOG_PREFIX} ${message}`),
  });
  const byDir = dedupeBy(toSkillSources(skillPackages), (source) => source.dir);
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
