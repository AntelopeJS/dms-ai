import {
  Context,
  Controller,
  Get,
  HTTPResult,
  Parameter,
  type RequestContext,
} from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { CSV_CONTENT_TYPE, HTTP_STATUS } from "../constants/http";
import { ROUTE_PREFIX } from "../constants/module";
import { buildQuery, pathSegment } from "../sidecar";
import type { ActivityRow, ActivityTableRow, SidecarList } from "../types";
import { activityCsv } from "./activity-csv";
import { type FilterMappings, sidecarListParams } from "./list-query";
import { relay } from "./sidecar-results";

const ACTIVITY_PATH = "/activity";
/** Most rows one export holds. */
const EXPORT_MAX_ROWS = "10000";
const EXPORT_FILE_PREFIX = "dms-ai-activity";
const ISO_DAY_LENGTH = 10;

const FILTERS: FilterMappings = {
  category: { param: "category" },
  tool: { param: "tool" },
  agent: { param: "agent" },
  conversationId: { param: "conversationId" },
  isReadOnly: { param: "hideReadOnly", values: { false: "true" } },
};

function tableRow(row: ActivityRow): ActivityTableRow {
  return {
    ...row,
    _id: row.id,
    timestamp: new Date(row.timestampMs).toISOString(),
  };
}

function tablePage(
  page: SidecarList<ActivityRow>,
): SidecarList<ActivityTableRow> {
  return { results: page.results.map(tableRow), total: page.total };
}

function exportResult(page: SidecarList<ActivityRow>): HTTPResult {
  const day = new Date().toISOString().slice(0, ISO_DAY_LENGTH);
  const result = new HTTPResult(
    HTTP_STATUS.OK,
    activityCsv(page.results),
    CSV_CONTENT_TYPE,
  );
  result.addHeader(
    "Content-Disposition",
    `attachment; filename="${EXPORT_FILE_PREFIX}-${day}.csv"`,
  );
  return result;
}

/**
 * The audit log: the Activity table's source (the DMS list query translated
 * to the sidecar's), one entry's detail for its drawer, and the CSV export.
 */
@AuthOwnerOnly()
export class AIActivityController extends Controller(ROUTE_PREFIX) {
  @Get(ACTIVITY_PATH)
  list(@Context() ctx: RequestContext): Promise<unknown> {
    const query = buildQuery(sidecarListParams(ctx.url.searchParams, FILTERS));
    return relay(`${ACTIVITY_PATH}${query}`, tablePage);
  }

  @Get(`${ACTIVITY_PATH}/export.csv`)
  export(@Context() ctx: RequestContext): Promise<unknown> {
    const params = sidecarListParams(ctx.url.searchParams, FILTERS);
    const query = buildQuery({
      ...params,
      offset: undefined,
      limit: EXPORT_MAX_ROWS,
    });
    return relay(`${ACTIVITY_PATH}${query}`, exportResult);
  }

  @Get(`${ACTIVITY_PATH}/:id`)
  detail(@Parameter("id", "param") id: string): Promise<unknown> {
    return relay(`${ACTIVITY_PATH}/${pathSegment(id)}`, tableRow);
  }
}
