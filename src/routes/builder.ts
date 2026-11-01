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

/**
 * The operations the sidecar may call: every operation of the interface except the ones named
 * here, picked by name so a key can never be paired with another operation.
 */
const {
  ConfigureResource: _configureResource,
  ListDataSources: _listDataSources,
  PreviewLayout: _previewLayout,
  PreviewQuery: _previewQuery,
  SetPageBlocks: _setPageBlocks,
  ...ROUTED
} = Builder.Operations;

type OpName = keyof typeof ROUTED;
type OpArgs = { [N in OpName]: Parameters<(typeof ROUTED)[N]> };

/** What the Builder operations answer, as the union of their results. */
type BuilderResult = Awaited<ReturnType<(typeof ROUTED)[OpName]>>;

type OpTable = {
  [N in OpName]: (...args: OpArgs[N]) => Promise<BuilderResult>;
};

const OPS: OpTable = ROUTED;

/** A request to run one operation, with the arguments that operation takes. */
type BuilderOpRequest = { [N in OpName]: { op: N; args: OpArgs[N] } }[OpName];

/** What arrives on the wire: the body is whatever the caller sent. */
interface BuilderOpBody {
  op?: unknown;
  args?: unknown;
}

function isOpName(op: unknown): op is OpName {
  return typeof op === "string" && Object.hasOwn(OPS, op);
}

/**
 * Whether the body names an operation of the table and carries an array of arguments. The
 * elements are not inspected: the sidecar's client types each call against the operation's
 * parameters, and the operation checks its own input.
 */
function isOpRequest(body: BuilderOpBody): body is BuilderOpRequest {
  return isOpName(body.op) && Array.isArray(body.args);
}

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
    if (!body || !isOpName(body.op)) {
      return new HTTPResult(HTTP_BAD_REQUEST, {
        error: "unknown_op",
        op: body?.op,
      });
    }
    if (!isOpRequest(body)) {
      return new HTTPResult(HTTP_BAD_REQUEST, {
        error: "invalid_args",
        op: body.op,
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
