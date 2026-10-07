import {
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
} from "../constants/audit.js";
import type { ActivityQuery } from "../audit/activity-query.js";
import type { MetricWindow } from "../metrics/types.js";

const MS_PER_DAY = 86_400_000;
const DEFAULT_RANGE_DAYS = 30;
const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 200;
const NUMERIC = /^\d+$/;
const TRUE_VALUE = "true";

/** An ISO date or a millisecond count, as the backend forwards them. */
export function parseTimestamp(value: string | null): number | undefined {
  if (!value) return undefined;
  if (NUMERIC.test(value)) return Number(value);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function parseWindow(params: URLSearchParams): MetricWindow {
  const toMs = parseTimestamp(params.get("to")) ?? Date.now();
  const fromMs =
    parseTimestamp(params.get("from")) ??
    toMs - DEFAULT_RANGE_DAYS * MS_PER_DAY;
  return {
    fromMs,
    toMs,
    compareFromMs: parseTimestamp(params.get("compareFrom")),
    compareToMs: parseTimestamp(params.get("compareTo")),
  };
}

export function parseCount(
  params: URLSearchParams,
  key: string,
  fallback: number,
): number {
  const raw = params.get(key);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) return fallback;
  return n;
}

export function parseLimit(
  params: URLSearchParams,
  fallback = DEFAULT_PAGE_LIMIT,
) {
  const limit = parseCount(params, "limit", fallback);
  return Math.min(limit === 0 ? fallback : limit, MAX_PAGE_LIMIT);
}

function optional(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  return value === null || value === "" ? undefined : value;
}

function parseCategory(
  value: string | undefined,
): ActivityCategory | undefined {
  return ACTIVITY_CATEGORIES.find((category) => category === value);
}

export function parseActivityQuery(params: URLSearchParams): ActivityQuery {
  return {
    offset: parseCount(params, "offset", 0),
    limit: parseLimit(params),
    search: optional(params, "search"),
    category: parseCategory(optional(params, "category")),
    tool: optional(params, "tool"),
    agent: optional(params, "agent"),
    conversationId: optional(params, "conversationId"),
    hideReadOnly: params.get("hideReadOnly") === TRUE_VALUE,
    fromMs: parseTimestamp(params.get("from")),
    toMs: parseTimestamp(params.get("to")),
  };
}

export { optional as optionalParam };

// The backend's router hands its own params on still encoded, then encodes
// them again when relaying, so an id may arrive encoded more than once.
const MAX_PARAM_DECODES = 3;

/**
 * A path parameter decoded until stable, or `null` when it is malformed.
 * Route ids never contain a literal `%`, so repeated decoding is lossless.
 */
export function decodeRouteParam(raw: string): string | null {
  let value = raw;
  for (let pass = 0; pass < MAX_PARAM_DECODES; pass++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return null;
    }
    if (decoded === value) return value;
    value = decoded;
  }
  return value;
}
