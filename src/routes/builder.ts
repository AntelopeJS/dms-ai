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
  "ComposePage",
  "ConfigureBlock",
  "ConfigureTableView",
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
  "PreviewQuery",
  "ConfigureQuery",
  "RemoveQuery",
  "ConfigureProject",
  "AddModule",
  "ConfigureModule",
  "CreateLocalModule",
  "MapResources",
  "PreviewMapResources",
  "AnalyseDatabase",
  "GetAnalysis",
  "GetMapping",
] as const;

/** The operations every Builder interface version exports, whose results type the answers. */
type ReleasedOpName = Exclude<(typeof OP_NAMES)[number], "PreviewMapResources">;

/** What the Builder operations answer, as the union of their results. */
type BuilderResult = Awaited<ReturnType<(typeof Builder)[ReleasedOpName]>>;
type BuilderOp = (...args: unknown[]) => Promise<BuilderResult>;

const BUILDER_EXPORTS = new Map<string, unknown>(Object.entries(Builder));

/**
 * The operations the installed interface exports. Read by name, so an interface older than
 * `PreviewMapResources` leaves that name out and the route answers `unknown_op` for it.
 */
const OPS = new Map<string, BuilderOp>(
  OP_NAMES.flatMap((name) => {
    const op = BUILDER_EXPORTS.get(name);
    return op ? [[name, op as BuilderOp] as const] : [];
  }),
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
    const fn = body?.op ? OPS.get(body.op) : undefined;
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
