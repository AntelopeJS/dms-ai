import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { ROUTE_PREFIX } from "../constants/module";
import { buildQuery, type QueryParams, sidecarGet } from "./proxy";

interface SeriesPoint {
  x: string;
  y: number;
}

interface NamedSeries {
  name: string;
  data: SeriesPoint[];
}

interface KpiPayload {
  value: number;
  delta: number;
  previousValue: number;
  sparkline: number[];
}

interface ChartPayload {
  value: number;
  delta: number;
  previousValue: number;
  series: NamedSeries[];
  comparisonSeries?: NamedSeries[];
}

interface TopListItem {
  id: string;
  title: string;
  description?: string;
  value: number;
  delta?: number | null;
}

interface TopListPayload {
  items: TopListItem[];
}

interface ActivityItem {
  id: string;
  timestampMs: number;
  toolName: string;
  status: "success" | "error" | "pending";
  conversationId: string;
  conversationTitle: string;
  summary: string;
}

interface ActivityPayload {
  items: ActivityItem[];
}

const EMPTY_KPI: KpiPayload = {
  value: 0,
  delta: 0,
  previousValue: 0,
  sparkline: [],
};
const EMPTY_CHART: ChartPayload = {
  value: 0,
  delta: 0,
  previousValue: 0,
  series: [{ name: "Actions", data: [] }],
};
const EMPTY_TOP: TopListPayload = { items: [] };
const EMPTY_ACTIVITY: ActivityPayload = { items: [] };

// Period query params the DMS chart components append to fetchUrl.
function periodQuery(
  from?: string,
  to?: string,
  compareFrom?: string,
  compareTo?: string,
  extra?: QueryParams,
): string {
  return buildQuery({ from, to, compareFrom, compareTo, ...extra });
}

@AuthOwnerOnly()
export class AIMetricsController extends Controller(`${ROUTE_PREFIX}/metrics`) {
  @Get("kpi/:metric")
  kpi(
    @Parameter("metric", "param") metric: string,
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
    @Parameter("compareFrom", "query") compareFrom?: string,
    @Parameter("compareTo", "query") compareTo?: string,
  ): Promise<KpiPayload> {
    const query = periodQuery(from, to, compareFrom, compareTo);
    return sidecarGet(`/metrics/kpi/${metric}${query}`, EMPTY_KPI);
  }

  @Get("series")
  series(
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
    @Parameter("compareFrom", "query") compareFrom?: string,
    @Parameter("compareTo", "query") compareTo?: string,
  ): Promise<ChartPayload> {
    const query = periodQuery(from, to, compareFrom, compareTo);
    return sidecarGet(`/metrics/series${query}`, EMPTY_CHART);
  }

  @Get("top-skills")
  topSkills(
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
    @Parameter("limit", "query") limit?: string,
  ): Promise<TopListPayload> {
    const query = periodQuery(from, to, undefined, undefined, { limit });
    return sidecarGet(`/metrics/top-skills${query}`, EMPTY_TOP);
  }
}

@AuthOwnerOnly()
export class AIActivityController extends Controller(ROUTE_PREFIX) {
  @Get("/activity")
  activity(
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
    @Parameter("limit", "query") limit?: string,
  ): Promise<ActivityPayload> {
    const query = periodQuery(from, to, undefined, undefined, { limit });
    return sidecarGet(`/activity${query}`, EMPTY_ACTIVITY);
  }
}
