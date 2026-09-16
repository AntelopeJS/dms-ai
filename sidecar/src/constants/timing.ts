// The host waits for its dev hot reload to serve the target route before
// pushing it (up to ~15s), so this budget must outlast that wait: a shorter one
// would report a timeout for a navigation that is merely waiting on the reload.
export const NAVIGATE_TIMEOUT_MS = 18_000;
