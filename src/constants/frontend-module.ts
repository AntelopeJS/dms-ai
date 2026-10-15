import type { FrontendBackendProxy } from "@antelopejs/interface-dms/page";
import { ROUTE_PREFIX } from "./module";

export const FRONTEND_MODULE_NAME = "@antelopejs/dms-ai-frontend-vue";
export const FRONTEND_MODULE_DIR = "../frontend-vue";
export const FRONTEND_MODULE_PRIORITY = 100;

/**
 * The module's routes, which the dashboard's views, blocks and assistant
 * channel call on the frontend's origin: proxied to the backend with the
 * session of the member signed in.
 */
export const FRONTEND_BACKEND_PROXY: FrontendBackendProxy = {
  path: `${ROUTE_PREFIX}/**`,
  auth: "session",
};
