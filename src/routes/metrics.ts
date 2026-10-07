import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { ROUTE_PREFIX } from "../constants/module";
import { buildQuery, type QueryParams, readSidecar } from "../sidecar";
import type {
  AllowedBreakdown,
  ChartPayload,
  KpiPayload,
  SidecarKpi,
  TopListPayload,
  TopTools,
  UsageReport,
} from "../types";
import {
  allowedPayload,
  kpiPayload,
  topToolsPayload,
  usageChartPayload,
  usageSummaryPayload,
} from "./metric-shapes";

const EMPTY_KPI: SidecarKpi = {
  value: 0,
  delta: 0,
  previousValue: 0,
  sparkline: [],
};
const EMPTY_CHART: ChartPayload = {
  value: 0,
  delta: 0,
  previousValue: 0,
  series: [],
};
const EMPTY_ALLOWED: AllowedBreakdown = {
  items: [],
  deletionsAsked: 0,
  deletions: 0,
};
const EMPTY_TOOLS: TopTools = { items: [] };
const EMPTY_USAGE: UsageReport = { days: [], totalTokens: 0, conversations: 0 };

/** The period parameters the DMS chart blocks append to their `fetchUrl`. */
interface PeriodParams extends QueryParams {
  from?: string;
  to?: string;
  compareFrom?: string;
  compareTo?: string;
}

/** Reads a sidecar metric and shapes it; an empty one while the sidecar is down. */
async function readMetric<T, R>(
  path: string,
  params: QueryParams,
  fallback: T,
  shape: (body: T) => R,
): Promise<R> {
  return shape(await readSidecar(`${path}${buildQuery(params)}`, fallback));
}

/**
 * The figures of the Overview and of Settings › Usage. They render empty
 * rather than fail while the sidecar is down, so they never answer 503.
 */
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
    const period: PeriodParams = { from, to, compareFrom, compareTo };
    const path = `/metrics/kpi/${encodeURIComponent(metric)}`;
    return readMetric(path, period, EMPTY_KPI, kpiPayload(metric));
  }

  @Get("series")
  series(
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
    @Parameter("compareFrom", "query") compareFrom?: string,
    @Parameter("compareTo", "query") compareTo?: string,
  ): Promise<ChartPayload> {
    const period: PeriodParams = { from, to, compareFrom, compareTo };
    return readSidecar(`/metrics/series${buildQuery(period)}`, EMPTY_CHART);
  }

  @Get("allowed")
  allowed(
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
  ): Promise<TopListPayload> {
    const period: PeriodParams = { from, to };
    return readMetric(
      "/metrics/allowed",
      period,
      EMPTY_ALLOWED,
      allowedPayload,
    );
  }

  @Get("top-tools")
  topTools(
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
    @Parameter("limit", "query") limit?: string,
  ): Promise<TopListPayload> {
    const params: QueryParams = { from, to, limit };
    return readMetric(
      "/metrics/top-tools",
      params,
      EMPTY_TOOLS,
      topToolsPayload,
    );
  }

  @Get("usage")
  usage(@Parameter("days", "query") days?: string): Promise<ChartPayload> {
    return readMetric(
      "/metrics/usage",
      { days },
      EMPTY_USAGE,
      usageChartPayload,
    );
  }

  @Get("usage/summary")
  usageSummary(@Parameter("days", "query") days?: string): Promise<unknown> {
    return readMetric(
      "/metrics/usage",
      { days },
      EMPTY_USAGE,
      usageSummaryPayload,
    );
  }
}
