import path from "node:path";
import { Logging } from "@antelopejs/interface-core/logging";
import { AddFrontendModule } from "@antelopejs/interface-dms/page";
import { isBuilderAvailable } from "./builder/presence";
import { getConfig, parseConfig, setConfig } from "./config";
import {
  FRONTEND_MODULE_DIR,
  FRONTEND_MODULE_NAME,
  FRONTEND_MODULE_PRIORITY,
} from "./constants/frontend-module";
import { SIDECAR_LOG_PREFIX } from "./constants/sidecar";
import { collectModuleRoots } from "./lifecycle/module-roots";
import { collectSkillSources } from "./lifecycle/skill-sources";
import { spawnSidecar } from "./lifecycle/spawn-sidecar";
import { startLogCapture } from "./logging/log-buffer";
import "./pages";
import "./routes";

export function construct(config: unknown): void {
  setConfig(parseConfig(config));
}

export async function start() {
  startLogCapture();
  await AddFrontendModule({
    name: FRONTEND_MODULE_NAME,
    sourcePath: path.join(__dirname, FRONTEND_MODULE_DIR),
    renderer: { name: "vue", version: "3" },
    priority: FRONTEND_MODULE_PRIORITY,
  });
  // Spawn from start(), not module load: by now every module is loaded, so
  // interface-core can report their on-disk roots and declared skills
  // authoritatively.
  const [moduleRoots, skillDirs, builderEnabled] = await Promise.all([
    collectModuleRoots(),
    collectSkillSources(),
    isBuilderAvailable(),
  ]);
  void spawnSidecar({
    hostProjectRoot: process.cwd(),
    ...getConfig(),
    moduleRoots,
    skillDirs,
    builderEnabled,
  }).catch((err) => {
    Logging.Error(`${SIDECAR_LOG_PREFIX} spawn failed:`, err);
  });
}
