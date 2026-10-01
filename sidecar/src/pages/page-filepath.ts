import path from "node:path";
import type { RegistryClient } from "./registry-client.js";
import { normalizeRoute } from "./route-match.js";
import type { PagesRegistryEntry } from "./types.js";

/** Resolves the source file of the page served at a route, if known. */
export type PageFilepathResolver = (
  pagePath: string,
) => Promise<string | undefined>;

/** Anchors a registry filepath to the host project root. */
export function toAbsolutePath(rootDir: string, filepath: string): string {
  if (path.isAbsolute(filepath)) return filepath;
  return path.resolve(rootDir, filepath);
}

async function readRegistrySafely(
  registry: RegistryClient,
): Promise<PagesRegistryEntry[]> {
  try {
    return await registry.getRegistry();
  } catch {
    return [];
  }
}

function findPageAt(
  entries: readonly PagesRegistryEntry[],
  pagePath: string,
): PagesRegistryEntry | undefined {
  const target = normalizeRoute(pagePath);
  return entries.find((entry) => normalizeRoute(entry.path) === target);
}

/**
 * Maps a route to its page's source file through the backend pages registry,
 * the same mapping the page tools rely on. Resolves to `undefined` when the
 * route is not registered, the registry lists no file for it, or the registry
 * cannot be reached.
 */
export function createPageFilepathResolver(
  registry: RegistryClient,
  hostProjectRoot: string,
): PageFilepathResolver {
  return async (pagePath) => {
    const page = findPageAt(await readRegistrySafely(registry), pagePath);
    if (page?.filepath === undefined) return undefined;
    return toAbsolutePath(hostProjectRoot, page.filepath);
  };
}
