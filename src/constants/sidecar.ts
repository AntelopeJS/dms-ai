export const SIDECAR_BIN_NAME = "dms-ai-sidecar";
export const SIDECAR_SPAWN_TIMEOUT_MS = 10_000;
export const SIDECAR_RESPAWN_MAX = 3;
export const SIDECAR_RESPAWN_WINDOW_MS = 60_000;
export const SIDECAR_RESPAWN_DELAY_MS = 500;
export const SIDECAR_LOG_PREFIX = "[dms-ai]";
export const SIDECAR_DISABLED_FLAG = "0";
export const SIDECAR_ENV_DISABLE_KEY = "DMS_AI";
export const SIDECAR_DIST_REL = "../../sidecar/dist/index.js";
export const SIDECAR_SUCCESS_EXIT_CODE = 0;
export const SIDECAR_CACHE_DIR_SEGMENTS = [
  "node_modules",
  ".cache",
  "dms-ai",
] as const;
export const SIDECAR_LOCK_FILE_NAME = "sidecar.lock";
export const SIDECAR_LOG_FILE_NAME = "sidecar.log";
export const SIDECAR_HEALTH_PATH = "/health";
export const SIDECAR_HEALTH_TIMEOUT_MS = 1000;
export const SIDECAR_LOCK_POLL_INTERVAL_MS = 100;
export const SIDECAR_BUILD_ID_FLAG = "--build-id";
export const SIDECAR_MODULE_ROOTS_FLAG = "--module-roots";
export const SIDECAR_SKILL_DIRS_FLAG = "--skill-dirs";
export const SIDECAR_BUILDER_FLAG = "--builder-enabled";
export const SIDECAR_BACKEND_URL_FLAG = "--backend-url";
export const SIDECAR_HOST_ORIGIN_FLAG = "--host-origin";
export const MODULE_ROOTS_TIMEOUT_MS = 3_000;
export const SIDECAR_DIST_EXTENSION = ".js";
export const SIDECAR_LOOPBACK_HOST = "127.0.0.1";
export const SIDECAR_AUTH_HEADER = "x-dms-ai-token";
