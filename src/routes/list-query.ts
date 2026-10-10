import type { QueryParams } from "../sidecar";

/** The list query a source table sends that the sidecar reads under the same name. */
const PASSED_PARAMS = ["offset", "limit", "search"] as const;
const FILTER_PARAM_PREFIX = "filter_";
/** The only filter mode the sidecar answers: tabs and quick filters send it. */
const EQUALS_MODE_PREFIX = "is:";

/** How a table column's filter reaches the sidecar. */
export interface FilterMapping {
  /** The sidecar's query parameter. */
  param: string;
  /** The parameter's value for each filtered value; others are dropped. */
  values?: Readonly<Record<string, string>>;
}

/** The sidecar parameters of each filterable column, by column. */
export type FilterMappings = Readonly<Record<string, FilterMapping>>;

function equalsValue(raw: string | null): string | undefined {
  if (raw === null || !raw.startsWith(EQUALS_MODE_PREFIX)) return undefined;
  const value = raw.slice(EQUALS_MODE_PREFIX.length);
  return value.length > 0 ? value : undefined;
}

function filterParams(
  search: URLSearchParams,
  mappings: FilterMappings,
): QueryParams {
  const params: QueryParams = {};
  for (const [column, mapping] of Object.entries(mappings)) {
    const value = equalsValue(search.get(`${FILTER_PARAM_PREFIX}${column}`));
    if (value === undefined) continue;
    params[mapping.param] = mapping.values ? mapping.values[value] : value;
  }
  return params;
}

/**
 * Translates the list query of a DMS source table — `offset`, `limit`,
 * `search` and `filter_<column>=is:<value>` — into the sidecar's parameters.
 */
export function sidecarListParams(
  search: URLSearchParams,
  mappings: FilterMappings = {},
): QueryParams {
  const params: QueryParams = {};
  for (const name of PASSED_PARAMS) {
    params[name] = search.get(name) ?? undefined;
  }
  return { ...params, ...filterParams(search, mappings) };
}

/** The value a column is filtered on, `is:` mode only. */
export function filteredValue(
  search: URLSearchParams,
  column: string,
): string | undefined {
  return equalsValue(search.get(`${FILTER_PARAM_PREFIX}${column}`));
}
