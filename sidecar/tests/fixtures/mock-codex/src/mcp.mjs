import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AUTHORIZATION_HEADER,
  BEARER_PREFIX,
  CODEX_HOME_ENV_VAR,
  CONFIG_FILE_NAME,
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
  MCP_CONFIG_URL_PATTERN,
  MCP_TOKEN_ENV_VAR,
} from "./constants.mjs";

// The sidecar hands the endpoint the same way it does to the real binary: the
// URL in the generated config.toml, the bearer in the environment.
function readMcpUrl() {
  const home = process.env[CODEX_HOME_ENV_VAR];
  if (home === undefined) return undefined;
  try {
    const toml = readFileSync(path.join(home, CONFIG_FILE_NAME), "utf8");
    return toml.match(MCP_CONFIG_URL_PATTERN)?.[1];
  } catch {
    return undefined;
  }
}

async function connect(url, token) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const client = new Client({
    name: MCP_CLIENT_NAME,
    version: MCP_CLIENT_VERSION,
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers: { [AUTHORIZATION_HEADER]: `${BEARER_PREFIX}${token}` },
      },
    }),
  );
  return client;
}

/**
 * Really calls the tool over the sidecar's MCP HTTP binding, so a replayed
 * mcpToolCall item exercises the same path the real binary takes — including
 * the per-conversation bearer that keeps two conversations apart.
 */
export async function callMcpTool(tool, args) {
  const url = readMcpUrl();
  const token = process.env[MCP_TOKEN_ENV_VAR];
  if (url === undefined || token === undefined) {
    return { error: "mock-codex: no MCP endpoint configured" };
  }
  let client;
  try {
    client = await connect(url, token);
    const result = await client.callTool({
      name: tool,
      arguments: args ?? {},
    });
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    await client?.close().catch(() => undefined);
  }
}
