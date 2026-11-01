import { z } from "zod";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModuleInfo, ListModules } from "@antelopejs/interface-core/modules";
import {
  MODULE_ROOTS_TIMEOUT_MS,
  SIDECAR_LOG_PREFIX,
} from "../constants/sidecar";

const RootPathSchema = z.string().min(1);

const LocalSourceSchema = z.object({
  type: z.enum(["local", "local-folder"]),
  path: RootPathSchema,
});

/**
 * interface-core calls queue indefinitely if the core isn't answerable yet, so
 * bound the gather: a stall must not wedge module start(), just degrade to the
 * host project root alone.
 */
function withTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), MODULE_ROOTS_TIMEOUT_MS);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * The authoritative on-disk roots of every loaded module, from interface-core —
 * `localPath` is where the module's code lives, and a local source's `path` is
 * the dev directory being watched. Both are auto-allowed for read-only tools by
 * the sidecar, so the agent never has to ask to read project or module files.
 * Best-effort: a registry that isn't answerable yet degrades to no extra roots
 * (the host project root alone), never a thrown boot.
 */
async function gatherModuleRoots(): Promise<string[]> {
  const ids = await ListModules();
  const infos = await Promise.all(
    ids.map((id) => GetModuleInfo(id).catch(() => null)),
  );
  const roots = new Set<string>();
  for (const info of infos) {
    if (info === null) continue;
    const localPath = RootPathSchema.safeParse(info.localPath);
    if (localPath.success) roots.add(localPath.data);
    const source = LocalSourceSchema.safeParse(info.source);
    if (source.success) roots.add(source.data.path);
  }
  return [...roots];
}

export async function collectModuleRoots(): Promise<string[]> {
  try {
    return await withTimeout(gatherModuleRoots(), []);
  } catch (err) {
    Logging.Error(`${SIDECAR_LOG_PREFIX} failed to collect module roots:`, err);
    return [];
  }
}
