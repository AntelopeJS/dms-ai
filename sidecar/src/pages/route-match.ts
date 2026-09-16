// Normalize a route for comparison: drop any query/hash, collapse leading and
// trailing slashes to a single leading slash. Registry paths are stored as
// `/modules/demo/pages/contact` (leading slash, no trailing), so this lets a
// loosely-typed agent path match the canonical form.
export function normalizeRoute(path: string): string {
  const pathOnly = path.split(/[?#]/, 1)[0] ?? path;
  const trimmed = pathOnly.replace(/^\/+|\/+$/g, "");
  return `/${trimmed}`;
}

export function isKnownRoute(path: string, knownRoutes: string[]): boolean {
  const target = normalizeRoute(path);
  return knownRoutes.some((route) => normalizeRoute(route) === target);
}
