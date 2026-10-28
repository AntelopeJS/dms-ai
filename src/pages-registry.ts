import { internal } from "@antelopejs/interface-dms/page";
import { z } from "zod";
import {
  DEFAULT_MODULE_ID,
  REGISTERED_FIELD,
} from "./constants/pages-registry";
import type { PagesRegistryEntry } from "./types/pages-registry";

/**
 * Reaches into an AntelopeJS internal: the runtime's registry is not on the
 * public type, and the source and target do not overlap, so a single assertion
 * is not expressible.
 */
function readRegisteredMap(): Map<unknown, unknown> {
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the runtime's registry is not on the public type and the source and target do not overlap
  const proxy = internal.RegisterPage as unknown as Record<string, unknown>;
  const map = proxy[REGISTERED_FIELD];
  if (!(map instanceof Map)) {
    return new Map();
  }
  return map;
}

const PageInfoSchema = z.object({
  fullId: z.string(),
  fullSlug: z.string(),
  module: z.string().optional().catch(undefined),
});

type RegisteredPage = z.infer<typeof PageInfoSchema>;

function resolveModuleId(pageInfo: RegisteredPage): string {
  return pageInfo.module ?? DEFAULT_MODULE_ID;
}

function toRegistryEntry(pageInfo: RegisteredPage): PagesRegistryEntry {
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
    const pageInfo = PageInfoSchema.safeParse(key);
    if (pageInfo.success) entries.push(toRegistryEntry(pageInfo.data));
  }
  return entries;
}
