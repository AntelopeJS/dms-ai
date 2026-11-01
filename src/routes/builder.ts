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

type Operations = typeof Builder.Operations;

/** Operations of the interface that the sidecar may not call. */
type WithheldOpName =
  | "ConfigureResource"
  | "ListDataSources"
  | "PreviewLayout"
  | "PreviewQuery"
  | "SetPageBlocks";

type OpName = Exclude<Builder.OperationName, WithheldOpName>;
type OpArgs = { [N in OpName]: Parameters<Operations[N]> };

/** What the Builder operations answer, as the union of their results. */
type BuilderResult = Awaited<ReturnType<Operations[OpName]>>;

type OpTable = {
  [N in OpName]: (...args: OpArgs[N]) => Promise<BuilderResult>;
};

const OPS: OpTable = {
  ListPages: Builder.Operations.ListPages,
  ListCategories: Builder.Operations.ListCategories,
  GetCatalog: Builder.Operations.GetCatalog,
  GetPageStructure: Builder.Operations.GetPageStructure,
  RefreshSourceIndex: Builder.Operations.RefreshSourceIndex,
  CreatePage: Builder.Operations.CreatePage,
  ConfigurePage: Builder.Operations.ConfigurePage,
  DeletePage: Builder.Operations.DeletePage,
  CreateCategory: Builder.Operations.CreateCategory,
  ConfigureCategory: Builder.Operations.ConfigureCategory,
  DeleteCategory: Builder.Operations.DeleteCategory,
  AddBlock: Builder.Operations.AddBlock,
  ConfigureBlock: Builder.Operations.ConfigureBlock,
  MoveBlock: Builder.Operations.MoveBlock,
  RemoveBlock: Builder.Operations.RemoveBlock,
  CreateResource: Builder.Operations.CreateResource,
  DeleteResource: Builder.Operations.DeleteResource,
  AddField: Builder.Operations.AddField,
  ConfigureField: Builder.Operations.ConfigureField,
  RemoveField: Builder.Operations.RemoveField,
  ListResources: Builder.Operations.ListResources,
  GetResourceStructure: Builder.Operations.GetResourceStructure,
  ListQueryTemplates: Builder.Operations.ListQueryTemplates,
  AddQuery: Builder.Operations.AddQuery,
  ConfigureQuery: Builder.Operations.ConfigureQuery,
  RemoveQuery: Builder.Operations.RemoveQuery,
  ConfigureProject: Builder.Operations.ConfigureProject,
  AddModule: Builder.Operations.AddModule,
  ConfigureModule: Builder.Operations.ConfigureModule,
  CreateLocalModule: Builder.Operations.CreateLocalModule,
  MapResources: Builder.Operations.MapResources,
  AnalyseDatabase: Builder.Operations.AnalyseDatabase,
  GetAnalysis: Builder.Operations.GetAnalysis,
  GetMapping: Builder.Operations.GetMapping,
};

/** A request to run one operation, with the arguments that operation takes. */
type BuilderOpBody = { [N in OpName]: { op: N; args: OpArgs[N] } }[OpName];

function runOp<N extends OpName>(
  op: N,
  args: OpArgs[N],
): Promise<BuilderResult> {
  return OPS[op](...args);
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
    if (!body || !Object.hasOwn(OPS, body.op)) {
      return new HTTPResult(HTTP_BAD_REQUEST, {
        error: "unknown_op",
        op: body?.op,
      });
    }
    try {
      const result = await runOp(body.op, body.args);
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
