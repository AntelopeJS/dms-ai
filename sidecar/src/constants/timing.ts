// The host waits for its dev hot reload to serve the target route before
// pushing it (up to ~15s), so this budget must outlast that wait: a shorter one
// would report a timeout for a navigation that is merely waiting on the reload.
export const NAVIGATE_TIMEOUT_MS = 18_000;

// Upper bound on how long a single tool call may hold the inactivity timer
// suspended. Far beyond any healthy tool (a typecheck on a large project is
// seconds, not minutes), it exists so that a tool whose result never arrives
// cannot keep a conversation alive forever.
export const TOOL_EXECUTION_CAP_MS = 600_000;
