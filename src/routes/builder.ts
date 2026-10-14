import {
  Controller,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import * as Builder from "@antelopejs/interface-dms-builder";
import { isBuilderAvailable } from "../builder/presence";
import {
  BUILDER_OP_PATH,
  BUILDER_STATUS_PATH,
  HTTP_BAD_REQUEST,
  HTTP_BUILDER_UNAVAILABLE,
  HTTP_OK,
} from "../constants/builder";
import { ROUTE_PREFIX } from "../constants/module";
import { catalogOf, listConnections } from "../database/catalog";
import { SIDECAR_AUTH_HEADER } from "../constants/sidecar";
import { isSidecarRequest, sidecarForbidden } from "./sidecar-auth";

type BuilderOp = (...args: unknown[]) => Promise<unknown>;

const OP_NAMES = [
  "ListPages",
  "ListCategories",
  "GetCatalog",
  "GetPageStructure",
  "RefreshSourceIndex",
  "CreatePage",
  "ConfigurePage",
  "DeletePage",
  "CreateCategory",
  "ConfigureCategory",
  "DeleteCategory",
  "AddBlock",
  "ConfigureBlock",
  "MoveBlock",
  "RemoveBlock",
  "CreateResource",
  "DeleteResource",
  "AddField",
  "ConfigureField",
  "RemoveField",
  "ListResources",
  "GetResourceStructure",
  "ListQueryTemplates",
  "AddQuery",
  "ConfigureQuery",
  "RemoveQuery",
  "ConfigureProject",
  "AddModule",
  "ConfigureModule",
  "CreateLocalModule",
] as const;

/**
 * `MapResources` takes the relations' descriptions from the connection's catalog here, so the
 * agent sends only its choices and never a description the builder would have to trust.
 */
async function mapResources(input: unknown): Promise<unknown> {
  const mapping = input as Builder.MapResourcesInput;
  const catalog = catalogOf(mapping.connection);
  if (!catalog) {
    return {
      ok: false,
      error: {
        code: "not_found",
        ref: `connection "${mapping.connection}"; the project declares ${listConnections().join(", ") || "none"}`,
      },
    };
  }
  const descriptions = await catalog.DescribeRelations(
    mapping.resources.map((resource) => resource.relation),
  );
  return Builder.MapResources(mapping, descriptions);
}

const COMPOSED_OPS: Record<string, BuilderOp> = {
  MapResources: (input) => mapResources(input),
};

const OPS: Record<string, BuilderOp> = {
  ...Object.fromEntries(
    OP_NAMES.map((name) => [name, Builder[name] as BuilderOp]),
  ),
  ...COMPOSED_OPS,
};

interface BuilderOpBody {
  op?: string;
  args?: unknown[];
}

export class AIBuilderController extends Controller(ROUTE_PREFIX) {
  @Post(BUILDER_OP_PATH)
  async op(
    @Parameter(SIDECAR_AUTH_HEADER, "header") token?: string,
    @JSONBody() body?: BuilderOpBody,
  ): Promise<unknown> {
    if (!isSidecarRequest(token)) {
      return sidecarForbidden();
    }
    const fn = body?.op ? OPS[body.op] : undefined;
    if (!fn) {
      return new HTTPResult(HTTP_BAD_REQUEST, {
        error: "unknown_op",
        op: body?.op,
      });
    }
    try {
      const result = await fn(...(body?.args ?? []));
      return result ?? { ok: true };
    } catch (err) {
      return new HTTPResult(HTTP_BUILDER_UNAVAILABLE, {
        error: "builder_unavailable",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  @Get(BUILDER_STATUS_PATH)
  async status(
    @Parameter(SIDECAR_AUTH_HEADER, "header") token?: string,
  ): Promise<HTTPResult> {
    if (!isSidecarRequest(token)) {
      return sidecarForbidden();
    }
    return new HTTPResult(HTTP_OK, { available: await isBuilderAvailable() });
  }
}
