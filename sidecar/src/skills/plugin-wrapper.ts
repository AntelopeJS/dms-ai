import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SkillSource } from "./types.js";

const PLUGIN_MANIFEST_DIR = ".claude-plugin";
const PLUGIN_MANIFEST_FILE = "plugin.json";
const PLUGIN_SKILLS_DIR = "skills";
const PLUGIN_VERSION = "0.0.1";
const PLUGIN_DESCRIPTION = "dms-ai skill bundle";
const WINDOWS_PLATFORM = "win32";

export interface PluginWrapper {
  pluginPath: string;
  pluginName: string;
}

// The on-disk folder is sanitized for filesystem safety, but the plugin.json
// `name` is the module verbatim — it becomes the `plugin:skill` namespace and
// MUST match the catalog id (`module:name`) so the loader allowlist lines up.
function sanitizeFolder(module: string): string {
  const cleaned = module.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const trimmed = cleaned.replace(/^-+|-+$/g, "");
  return trimmed.length > 0 ? trimmed : "skills";
}

async function linkSkills(target: string, linkPath: string): Promise<void> {
  await rm(linkPath, { recursive: true, force: true });
  const type = process.platform === WINDOWS_PLATFORM ? "junction" : "dir";
  try {
    await symlink(target, linkPath, type);
  } catch {
    // Platforms/filesystems without symlink support: fall back to a copy so
    // the SDK can still discover the skills under `<wrapper>/skills`.
    await cp(target, linkPath, { recursive: true });
  }
}

// Contributors ship bare skill dirs, but the SDK loads skills via *plugins*. This
// synthesizes a minimal local-plugin dir (`.claude-plugin/plugin.json` + a
// `skills` link to the source) so the dir can be passed as a local plugin.
// Idempotent: safe to call on every prompt.
export async function ensurePluginWrapper(
  source: SkillSource,
  baseDir: string,
): Promise<PluginWrapper> {
  const pluginPath = path.join(baseDir, sanitizeFolder(source.module));
  const manifestDir = path.join(pluginPath, PLUGIN_MANIFEST_DIR);
  await mkdir(manifestDir, { recursive: true });
  const manifest = {
    name: source.module,
    version: PLUGIN_VERSION,
    description: PLUGIN_DESCRIPTION,
  };
  await writeFile(
    path.join(manifestDir, PLUGIN_MANIFEST_FILE),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  await linkSkills(source.dir, path.join(pluginPath, PLUGIN_SKILLS_DIR));
  return { pluginPath, pluginName: source.module };
}
