import path from "node:path";
import type { AddFrontendModuleOptions } from "@antelopejs/interface-dms/page";
import {
  FRONTEND_BACKEND_PROXY,
  FRONTEND_MODULE_DIR,
  FRONTEND_MODULE_NAME,
  FRONTEND_MODULE_PRIORITY,
} from "./constants/frontend-module";

/**
 * This module's frontend, from its configuration alone: the backend registers
 * it with `AddFrontendModule`, and `@antelopejs/dms-frontend` calls this same
 * function (declared as `dmsFrontend` in package.json) to build and start the
 * frontend without a backend. It reads nothing but its arguments.
 */
export function frontendModule(): AddFrontendModuleOptions {
  return {
    name: FRONTEND_MODULE_NAME,
    sourcePath: path.join(__dirname, FRONTEND_MODULE_DIR),
    renderer: { name: "vue", version: "3" },
    priority: FRONTEND_MODULE_PRIORITY,
    backendProxies: [FRONTEND_BACKEND_PROXY],
  };
}
