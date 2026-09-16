import { internal, type PageInfo } from "@antelopejs/interface-dms/page";
import {
  DEFAULT_MODULE_ID,
  REGISTERED_FIELD,
} from "./constants/pages-registry";
import type { PagesRegistryEntry } from "./types/pages-registry";

function readRegisteredMap(): Map<unknown, unknown> {
  // Reaching into an AntelopeJS internal: the runtime's registry is
  // not on the public type, and the source and target do not overlap,
  // so a single assertion is not expressible.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  const proxy = internal.RegisterPage as unknown as Record<string, unknown>;
  const map = proxy[REGISTERED_FIELD];
  if (!(map instanceof Map)) {
    return new Map();
  }
  return map;
}

function isPageInfo(value: unknown): value is PageInfo {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.fullId === "string" &&
    typeof candidate.fullSlug === "string"
  );
}

function resolveModuleId(pageInfo: PageInfo): string {
  return pageInfo.module ?? DEFAULT_MODULE_ID;
}

function toRegistryEntry(pageInfo: PageInfo): PagesRegistryEntry {
  return {
    id: pageInfo.fullId,
    path: pageInfo.fullSlug,
    moduleId: resolveModuleId(pageInfo),
  };
}

export function listPagesRegistry(): PagesRegistryEntry[] {
  const registered = readRegisteredMap();
  const entries: PagesRegistryEntry[] = [];
  for (const key of registered.keys()) {
    if (!isPageInfo(key)) continue;
    entries.push(toRegistryEntry(key));
  }
  return entries;
}
