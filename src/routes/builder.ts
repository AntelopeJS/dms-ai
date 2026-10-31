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
import { SIDECAR_AUTH_HEADER } from "../constants/sidecar";
import { isSidecarRequest, sidecarForbidden } from "./sidecar-auth";

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
  "MapResources",
  "AnalyseDatabase",
  "GetAnalysis",
  "GetMapping",
] as const;

type OpName = (typeof OP_NAMES)[number];

/** What the Builder operations answer, as the union of their results. */
type BuilderResult = Awaited<ReturnType<(typeof Builder)[OpName]>>;
type BuilderOp = (...args: unknown[]) => Promise<BuilderResult>;

const OPS: Record<string, BuilderOp> = Object.fromEntries(
  OP_NAMES.map((name) => [name, Builder[name] as BuilderOp]),
);

interface BuilderOpBody {
  op?: string;
  args?: unknown[];
}

export class AIBuilderController extends Controller(ROUTE_PREFIX) {
  @Post(BUILDER_OP_PATH)
  async op(
    @Parameter(SIDECAR_AUTH_HEADER, "header") token?: string,
    @JSONBody() body?: BuilderOpBody,
  ): Promise<BuilderResult | HTTPResult | { ok: true }> {
    if (!isSidecarRequest(token)) {
      return sidecarForbidden();
    }
    const fn =
      body?.op && Object.hasOwn(OPS, body.op) ? OPS[body.op] : undefined;
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
