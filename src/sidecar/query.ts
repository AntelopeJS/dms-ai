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

function decodeOnce(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * A route parameter as one sidecar path segment. The api router hands
 * parameters over still percent-encoded, so they are decoded before being
 * encoded again rather than encoded twice.
 */
export function pathSegment(raw: string): string {
  return encodeURIComponent(decodeOnce(raw));
}
