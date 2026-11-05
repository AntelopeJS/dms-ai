/** The backend route an outside agent session reaches the project's MCP tools on. */
export const MCP_ROUTE_PATH = "/mcp";
/** The sidecar endpoint the route relays to. */
export const SIDECAR_MCP_PROJECT_PATH = "/mcp/project";
/**
 * The backend origin when the module config sets no `backendUrl`: the same
 * default the sidecar falls back to.
 */
export const DEFAULT_BACKEND_URL = "http://localhost:5010";
/** Where the bridge finds the route and its credential, in the module's cache directory. */
export const MCP_BRIDGE_CONFIG_FILE_NAME = "mcp.json";
/** The launcher `.mcp.json` points at, in the module's cache directory. */
export const MCP_BRIDGE_LAUNCHER_FILE_NAME = "mcp-bridge.cjs";
/** The project file Claude Code reads its project-scoped MCP servers from. */
export const PROJECT_MCP_JSON_FILE_NAME = ".mcp.json";
/** The key of the project's MCP server in `.mcp.json`, and so the `mcp__dms-ai__` tool prefix. */
export const PROJECT_MCP_SERVER_KEY = "dms-ai";
export const MCP_TOKEN_BYTES = 32;
export const PRIVATE_FILE_MODE = 0o600;
/** Remote addresses the route accepts: the bridge runs on the backend's machine. */
export const LOOPBACK_ADDRESSES: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);
/** Headers a proxy adds; the bridge sends none of them. */
export const FORWARDING_HEADERS = ["x-forwarded-for", "forwarded"] as const;
export const HTTP_ACCEPTED = 202;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_FORBIDDEN = 403;
/** JSON-RPC's code for a server-side failure, used when the backend is unreachable. */
export const JSON_RPC_INTERNAL_ERROR = -32603;
export const BACKEND_DOWN_MESSAGE =
  "The DMS backend is not running or refused the call. Start the project (ajs project dev), then retry.";
