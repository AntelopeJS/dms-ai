import { z } from "zod";

/** Module configuration, as declared under `modules["dms-ai"].config`. */
export interface AIConfig {
  /** Origin the sidecar reaches the DMS backend on, flags and all. */
  backendUrl?: string;
  /** `false` keeps the module from adding its MCP server to the project's `.mcp.json`. */
  mcpJson?: boolean;
}

const OriginSchema = z.string().trim().min(1);

/**
 * Keeps only the keys this module understands: `backendUrl` when it carries a
 * non-empty origin, `mcpJson` only as `false`. Anything else leaves the module
 * on its defaults.
 */
export const ConfigSchema = z
  .object({
    backendUrl: z.unknown().optional(),
    mcpJson: z.unknown().optional(),
  })
  .transform(({ backendUrl, mcpJson }): AIConfig => {
    const config: AIConfig = {};
    const origin = OriginSchema.safeParse(backendUrl);
    if (origin.success) config.backendUrl = origin.data;
    if (mcpJson === false) config.mcpJson = false;
    return config;
  });

let current: AIConfig = {};

export function setConfig(config: AIConfig): void {
  current = config;
}

export function getConfig(): AIConfig {
  return current;
}
