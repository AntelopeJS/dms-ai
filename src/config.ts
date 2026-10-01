/** Module configuration, as declared under `modules["dms-ai"].config`. */
export interface AIConfig {
  /** Origin the sidecar reaches the DMS backend on, flags and all. */
  backendUrl?: string;
  /**
   * Accepted and ignored, with a warning.
   *
   * @deprecated Nothing reads it; it will be removed in the next minor.
   */
  hostOrigin?: string;
}

const CONFIG_KEYS = ["backendUrl"] as const;
const DEPRECATED_HOST_ORIGIN_KEY = "hostOrigin";

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

/**
 * Whether the raw config still sets the deprecated `hostOrigin` option.
 */
export function hasDeprecatedHostOrigin(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  return (
    (raw as Record<string, unknown>)[DEPRECATED_HOST_ORIGIN_KEY] !== undefined
  );
}

export function setConfig(config: AIConfig): void {
  current = config;
}

export function getConfig(): AIConfig {
  return current;
}
