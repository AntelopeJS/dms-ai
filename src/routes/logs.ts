import {
  Controller,
  Get,
  type HTTPResult,
  Parameter,
} from "@antelopejs/interface-api";
import { ROUTE_PREFIX } from "../constants/module";
import { SIDECAR_AUTH_HEADER } from "../constants/sidecar";
import { queryLogs } from "../logging/log-buffer";
import type { BufferedLog } from "../types/logs";
import { isSidecarRequest, sidecarForbidden } from "./sidecar-auth";

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export class AILogsController extends Controller(ROUTE_PREFIX) {
  @Get("/logs")
  logs(
    @Parameter(SIDECAR_AUTH_HEADER, "header") token?: string,
    @Parameter("since", "query") since?: string,
    @Parameter("level", "query") level?: string,
    @Parameter("channel", "query") channel?: string,
    @Parameter("limit", "query") limit?: string,
  ): BufferedLog[] | HTTPResult {
    if (!isSidecarRequest(token)) return sidecarForbidden();
    return queryLogs({
      since: toNumber(since),
      level: toNumber(level),
      channel:
        channel !== undefined && channel.length > 0 ? channel : undefined,
      limit: toNumber(limit),
    });
  }
}
