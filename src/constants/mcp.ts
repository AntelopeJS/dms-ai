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
/**
 * Remote address forms of a loopback caller: IPv6 `::1`, and the whole
 * `127.0.0.0/8` range, plain or IPv4-mapped (Debian names the host `127.0.1.1`).
 */
export const LOOPBACK_IPV6 = "::1";
export const LOOPBACK_IPV4_PREFIXES = ["127.", "::ffff:127."] as const;
/** Headers a proxy adds; the bridge sends none of them. */
export const FORWARDING_HEADERS = ["x-forwarded-for", "forwarded"] as const;
export const HTTP_ACCEPTED = 202;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_FORBIDDEN = 403;
/** JSON-RPC's code for a server-side failure, used when the backend is unreachable. */
export const JSON_RPC_INTERNAL_ERROR = -32603;
/** The bridge's answer when the backend does not answer at all. */
export const BRIDGE_UNREACHABLE =
  "The DMS backend is not running. Start the project (ajs project dev), then retry.";
/** The bridge's answer to each refusal of the route, keyed by HTTP status. */
export const BRIDGE_REFUSALS: ReadonlyMap<number, string> = new Map([
  [
    401,
    "The DMS backend refused the bridge's credential. Restart the project (ajs project dev), then retry.",
  ],
  [
    403,
    "The DMS backend refused a caller that is not on its machine. Set the dms-ai backendUrl to a loopback address such as http://localhost:5010.",
  ],
  [
    413,
    "The request is over the 1 MiB the assistant reads. Split it into smaller calls.",
  ],
  [
    503,
    "The DMS backend could not reach the assistant's sidecar. Check the backend log, or restart the project (ajs project dev).",
  ],
]);
