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
] as const;

// Resolved dynamically: installed dms-builder versions may not export every
// op yet; missing ones fall through to the unknown_op response.
const BUILDER_EXPORTS = Builder as Record<string, unknown>;

const OPS: Record<string, BuilderOp> = Object.fromEntries(
  OP_NAMES.flatMap((name) => {
    const fn = BUILDER_EXPORTS[name];
    return typeof fn === "function" ? [[name, fn as BuilderOp]] : [];
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
