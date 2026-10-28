import { z } from "zod";

/** Module configuration, as declared under `modules["dms-ai"].config`. */
export interface AIConfig {
  /** Origin the sidecar reaches the DMS backend on, flags and all. */
  backendUrl?: string;
}

const OriginSchema = z.string().trim().min(1);

/**
 * Keeps only the keys this module understands, and only when they carry a
 * non-empty origin: anything else leaves the sidecar on its own defaults.
 */
export const ConfigSchema = z
  .object({ backendUrl: z.unknown() })
  .transform(({ backendUrl }): AIConfig => {
    const origin = OriginSchema.safeParse(backendUrl);
    return origin.success ? { backendUrl: origin.data } : {};
  });

let current: AIConfig = {};

export function setConfig(config: AIConfig): void {
  current = config;
}

export function getConfig(): AIConfig {
  return current;
}
