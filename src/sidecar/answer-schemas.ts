import { z } from "zod";
import type {
  AllowedBreakdown,
  ChartPayload,
  SidecarKpi,
  SidecarSkillConflicts,
  TopTools,
  UsageReport,
} from "../types";

/** Objects keep the members the routes do not name, so a well-formed answer reaches them as the sidecar sent it. */
const SERIES_POINT = z.looseObject({ x: z.string(), y: z.number() });
const NAMED_SERIES = z.looseObject({
  name: z.string(),
  data: z.array(SERIES_POINT),
});
const COUNTED_VALUE = {
  id: z.string(),
  value: z.number(),
  delta: z.number().optional(),
};
const SKILL_ORIGIN = z.looseObject({ source: z.string(), origin: z.string() });

export const KPI_ANSWER: z.ZodType<SidecarKpi> = z.looseObject({
  value: z.number(),
  delta: z.number().optional(),
  previousValue: z.number().optional(),
  sparkline: z.array(z.number()),
  caption: z.string().optional(),
  total: z.number().optional(),
  denied: z.number().optional(),
  expired: z.number().optional(),
});

export const CHART_ANSWER: z.ZodType<ChartPayload> = z.looseObject({
  value: z.number(),
  delta: z.number().optional(),
  previousValue: z.number().optional(),
  series: z.array(NAMED_SERIES),
  comparisonSeries: z.array(NAMED_SERIES).optional(),
});

export const ALLOWED_ANSWER: z.ZodType<AllowedBreakdown> = z.looseObject({
  items: z.array(z.looseObject(COUNTED_VALUE)),
  deletionsAsked: z.number(),
  deletions: z.number(),
});

export const TOP_TOOLS_ANSWER: z.ZodType<TopTools> = z.looseObject({
  items: z.array(z.looseObject({ ...COUNTED_VALUE, source: z.string() })),
});

export const USAGE_ANSWER: z.ZodType<UsageReport> = z.looseObject({
  days: z.array(z.looseObject({ day: z.string(), totalTokens: z.number() })),
  totalTokens: z.number(),
  conversations: z.number(),
  top: z
    .looseObject({
      conversationId: z.string(),
      title: z.string(),
      totalTokens: z.number(),
    })
    .optional(),
});

export const CONFLICTS_ANSWER: z.ZodType<SidecarSkillConflicts> = z.looseObject(
  {
    conflicts: z.array(
      z.looseObject({
        name: z.string(),
        winner: SKILL_ORIGIN,
        ignored: z.array(SKILL_ORIGIN),
      }),
    ),
  },
);
