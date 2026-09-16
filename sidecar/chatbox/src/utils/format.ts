// Render an arbitrary tool argument / result value for display: strings pass
// through, everything else is pretty-printed JSON, with a safe fallback for
// values JSON can't serialize (e.g. circular refs).
export function stringifyValue(value: unknown): string {
	if (value === undefined) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}
