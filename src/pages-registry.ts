import { internal } from "@antelopejs/interface-dms/page";
import { z } from "zod";
import {
  DEFAULT_MODULE_ID,
  REGISTERED_FIELD,
} from "./constants/pages-registry";
import type { PagesRegistryEntry } from "./types/pages-registry";

/**
 * Reaches into an AntelopeJS internal: the runtime's registry is a field of
 * the registering proxy that its public type does not declare, so it is read
 * from the instance's own properties.
 */
function readRegisteredMap(): Map<unknown, unknown> {
  const registered: unknown = Object.getOwnPropertyDescriptor(
    internal.RegisterPage,
    REGISTERED_FIELD,
  )?.value;
  return registered instanceof Map ? registered : new Map();
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
