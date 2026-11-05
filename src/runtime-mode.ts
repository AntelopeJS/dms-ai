import { GetRuntimeInfo } from "@antelopejs/interface-core/runtime";

interface RuntimeMode {
  isDevelopment: boolean;
}

const runtime: RuntimeMode = { isDevelopment: false };

/**
 * Reads core's development flag, the one dms and dms-builder go by. Until it
 * is read the module counts as running in production.
 */
export async function loadRuntimeMode(): Promise<void> {
  runtime.isDevelopment = (await GetRuntimeInfo()).dev;
}

export function isDevelopment(): boolean {
  return runtime.isDevelopment;
}
