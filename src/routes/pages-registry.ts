import {
  Controller,
  Get,
  type HTTPResult,
  Parameter,
} from "@antelopejs/interface-api";
import * as Builder from "@antelopejs/interface-dms-builder";
import { isBuilderAvailable } from "../builder/presence";
import { ROUTE_PREFIX } from "../constants/module";
import { SIDECAR_AUTH_HEADER } from "../constants/sidecar";
import { listPagesRegistry } from "../pages-registry";
import type { PagesRegistryEntry } from "../types/pages-registry";
import { isSidecarRequest, sidecarForbidden } from "./sidecar-auth";

// The runtime registry has no file path (it knows route/id/module only). When the
// Builder is present, enrich each entry with the real source file it resolves from
// its own scan, keyed by route — so page-file tools work for every page.
async function withBuilderFilepaths(
  entries: PagesRegistryEntry[],
): Promise<PagesRegistryEntry[]> {
  if (!(await isBuilderAvailable())) return entries;
  try {
    const pages = await Builder.ListPages();
    const byRoute = new Map(pages.map((page) => [page.ref, page.filepath]));
    return entries.map((entry) => ({
      ...entry,
      filepath: byRoute.get(entry.path) ?? entry.filepath,
    }));
  } catch {
    return entries;
  }
}

export class AIPagesRegistryController extends Controller(ROUTE_PREFIX) {
  @Get("/pages-registry")
  async pagesRegistry(
    @Parameter(SIDECAR_AUTH_HEADER, "header") token?: string,
  ): Promise<PagesRegistryEntry[] | HTTPResult> {
    if (!isSidecarRequest(token)) return sidecarForbidden();
    return withBuilderFilepaths(listPagesRegistry());
  }
}
