import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const CHATBOX_DIST_DIR = resolve(here, "../../chatbox/dist");
export const SIDECAR_PACKAGE_JSON = resolve(here, "../../package.json");
export const STATE_DIR_SEGMENTS = ["node_modules", ".cache", "dms-ai"] as const;
