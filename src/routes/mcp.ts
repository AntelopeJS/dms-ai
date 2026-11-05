import {
  Context,
  Controller,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
  type RequestContext,
} from "@antelopejs/interface-api";
import {
  FORWARDING_HEADERS,
  HTTP_ACCEPTED,
  HTTP_FORBIDDEN,
  HTTP_UNAUTHORIZED,
  LOOPBACK_IPV4_PREFIXES,
  LOOPBACK_IPV6,
  MCP_ROUTE_PATH,
  SIDECAR_MCP_PROJECT_PATH,
} from "../constants/mcp";
import { ROUTE_PREFIX } from "../constants/module";
import {
  SIDECAR_UNAVAILABLE_BODY,
  SIDECAR_UNAVAILABLE_STATUS,
} from "../constants/sidecar";
import { isProjectMcpRequest } from "../lifecycle/project-mcp";
import { isSidecarDisabled } from "../lifecycle/spawn-sidecar";
import { relaySidecar } from "../sidecar/http-client";

const JSON_CONTENT_TYPE = "application/json";

/**
 * A caller on this machine that came straight to the backend. The DMS
 * frontend server sits on the same machine and relays `/ai/**` with the
 * client's address in a forwarding header, so a proxied request is refused
 * even though it arrives from loopback.
 */
function isDirectLocalCall(ctx: RequestContext): boolean {
  const { headers, socket } = ctx.rawRequest;
  if (FORWARDING_HEADERS.some((name) => headers[name] !== undefined)) {
    return false;
  }
  const address = socket.remoteAddress ?? "";
  return (
    address === LOOPBACK_IPV6 ||
    LOOPBACK_IPV4_PREFIXES.some((prefix) => address.startsWith(prefix))
  );
}

/**
 * The project's MCP tools for an agent session outside the dashboard chat, as
 * relayed by the stdio bridge `.mcp.json` launches. Only a caller on this
 * machine holding the credential of this start gets through, and nothing is
 * served where the sidecar is turned off (production).
 */
export class AIMcpController extends Controller(ROUTE_PREFIX) {
  @Post(MCP_ROUTE_PATH)
  async relay(
    @Context() ctx: RequestContext,
    @Parameter("authorization", "header") authorization?: string,
    @JSONBody() body?: unknown,
  ): Promise<HTTPResult> {
    if (!isDirectLocalCall(ctx)) {
      return new HTTPResult(HTTP_FORBIDDEN, { error: "forbidden" });
    }
    if (!isProjectMcpRequest(authorization)) {
      return new HTTPResult(HTTP_UNAUTHORIZED, { error: "unauthorized" });
    }
    if (isSidecarDisabled()) {
      return new HTTPResult(
        SIDECAR_UNAVAILABLE_STATUS,
        SIDECAR_UNAVAILABLE_BODY,
      );
    }
    try {
      const answer = await relaySidecar(
        SIDECAR_MCP_PROJECT_PATH,
        JSON.stringify(body ?? null),
      );
      if (answer.status === HTTP_ACCEPTED) return new HTTPResult(HTTP_ACCEPTED);
      return new HTTPResult(answer.status, answer.text, JSON_CONTENT_TYPE);
    } catch {
      return new HTTPResult(
        SIDECAR_UNAVAILABLE_STATUS,
        SIDECAR_UNAVAILABLE_BODY,
      );
    }
  }
}
