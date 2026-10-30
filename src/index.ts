import { Logging } from "@antelopejs/interface-core/logging";
import { AddFrontendModule } from "@antelopejs/interface-dms/page";
import { isBuilderAvailable } from "./builder/presence";
import { closeAllBridges } from "./channels/registry";
import { ConfigSchema, getConfig, setConfig } from "./config";
import { SIDECAR_LOG_PREFIX } from "./constants/sidecar";
import { collectModuleRoots } from "./lifecycle/module-roots";
import { collectSkillSources } from "./lifecycle/skill-sources";
import { spawnSidecar } from "./lifecycle/spawn-sidecar";
import { startLogCapture } from "./logging/log-buffer";
import "./pages";
import "./routes";
import { frontendModule } from "./frontend-module";

export function construct(config: unknown): void {
  setConfig(ConfigSchema.safeParse(config).data ?? {});
}

/**
 * Spawns the sidecar from start(), not module load: by now every module is
 * loaded, so interface-core can report their on-disk roots and declared skills
 * authoritatively.
 */
export async function start() {
  startLogCapture();
  await AddFrontendModule(frontendModule());
  const hostProjectRoot = process.cwd();
  const [moduleRoots, skillDirs, builderEnabled] = await Promise.all([
    collectModuleRoots(),
    collectSkillSources(hostProjectRoot),
    isBuilderAvailable(),
  ]);
  void spawnSidecar({
    hostProjectRoot,
    ...getConfig(),
    moduleRoots,
    skillDirs,
    builderEnabled,
  }).catch((err: unknown) => {
    Logging.Error(`${SIDECAR_LOG_PREFIX} spawn failed:`, err);
  });
}

/**
 * Ends every browser stream and sidecar socket this instance bridged. A hot
 * reload replaces the module with a fresh copy, so anything left open here would
 * outlive it; the browser reconnects to the new instance on its own.
 */
export function destroy(): void {
  closeAllBridges();
}
