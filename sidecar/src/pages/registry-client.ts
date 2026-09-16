import { SIDECAR_AUTH_HEADER } from "../constants/daemon.js";
import {
  PAGES_LOG_PREFIX,
  REGISTRY_CACHE_TTL_MS,
  REGISTRY_FETCH_TIMEOUT_MS,
  REGISTRY_PATH,
  REGISTRY_STALE_FALLBACK_MESSAGE,
} from "../constants/pages.js";
import type { PagesRegistryEntry } from "./types.js";

export interface RegistryClient {
  getRegistry(): Promise<PagesRegistryEntry[]>;
  getStaleSinceMs(): number | null;
  invalidate(): void;
}

export interface RegistryClientOptions {
  backendBaseUrl: string;
  token?: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
  ttlMs?: number;
  logger?: Pick<Console, "warn">;
}

interface RegistryCache {
  entries: PagesRegistryEntry[];
  fetchedAtMs: number;
}

function buildUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}${REGISTRY_PATH}`;
}

function isFreshCache(
  cache: RegistryCache | null,
  nowMs: number,
  ttlMs: number,
): cache is RegistryCache {
  if (cache === null) return false;
  return nowMs - cache.fetchedAtMs < ttlMs;
}

async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRegistry(
  url: string,
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
): Promise<PagesRegistryEntry[]> {
  const response = await fetchWithTimeout(url, fetchImpl, headers);
  if (!response.ok) {
    throw new Error(`registry fetch failed: ${response.status}`);
  }
  const data = (await response.json()) as PagesRegistryEntry[];
  return Array.isArray(data) ? data : [];
}

interface StaleState {
  staleSinceMs: number | null;
  mustLogOnNextFallback: boolean;
}

function createStaleState(): StaleState {
  return { staleSinceMs: null, mustLogOnNextFallback: true };
}

function markFresh(state: StaleState): void {
  state.staleSinceMs = null;
  state.mustLogOnNextFallback = true;
}

function markStale(
  state: StaleState,
  nowMs: number,
  logger: Pick<Console, "warn">,
  err: unknown,
): void {
  if (state.staleSinceMs === null) state.staleSinceMs = nowMs;
  if (!state.mustLogOnNextFallback) return;
  state.mustLogOnNextFallback = false;
  const reason = err instanceof Error ? err.message : String(err);
  logger.warn(
    `${PAGES_LOG_PREFIX} ${REGISTRY_STALE_FALLBACK_MESSAGE} (since=${state.staleSinceMs}, reason=${reason})`,
  );
}

export function createRegistryClient(
  opts: RegistryClientOptions,
): RegistryClient {
  const url = buildUrl(opts.backendBaseUrl);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? REGISTRY_CACHE_TTL_MS;
  const logger = opts.logger ?? console;
  const headers: Record<string, string> =
    opts.token === undefined ? {} : { [SIDECAR_AUTH_HEADER]: opts.token };
  const staleState = createStaleState();
  let cache: RegistryCache | null = null;
  const refresh = async (): Promise<PagesRegistryEntry[]> => {
    try {
      const entries = await fetchRegistry(url, fetchImpl, headers);
      cache = { entries, fetchedAtMs: now() };
      markFresh(staleState);
      return entries;
    } catch (err) {
      if (cache !== null) {
        markStale(staleState, now(), logger, err);
        return cache.entries;
      }
      throw err;
    }
  };
  return {
    getRegistry: async () => {
      if (isFreshCache(cache, now(), ttlMs)) return cache.entries;
      return refresh();
    },
    getStaleSinceMs: () => staleState.staleSinceMs,
    invalidate: () => {
      cache = null;
      markFresh(staleState);
    },
  };
}
