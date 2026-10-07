/** Query parameters, the ones left undefined or empty being dropped. */
export type QueryParams = Record<string, string | undefined>;

/** `?a=1&b=2` from the set parameters, or nothing when none is. */
export function buildQuery(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}
