/** Module configuration, as declared under `modules["dms-ai"].config`. */
export interface AIConfig {
  /** Origin the sidecar reaches the DMS backend on, flags and all. */
  backendUrl?: string;
  /** Origin the DMS frontend is served from. */
  hostOrigin?: string;
}

const CONFIG_KEYS = ["backendUrl", "hostOrigin"] as const;

let current: AIConfig = {};

function readOrigin(
  raw: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = raw[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Keeps only the keys this module understands, and only when they carry a
 * non-empty origin: anything else leaves the sidecar on its own defaults.
 */
export function parseConfig(raw: unknown): AIConfig {
  if (raw === null || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const parsed: AIConfig = {};
  for (const key of CONFIG_KEYS) {
    const origin = readOrigin(source, key);
    if (origin !== undefined) parsed[key] = origin;
  }
  return parsed;
}

export function setConfig(config: AIConfig): void {
  current = config;
}

export function getConfig(): AIConfig {
  return current;
}
