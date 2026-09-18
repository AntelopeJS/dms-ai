import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SIDECAR_TOKEN_BYTES } from "../constants/daemon.js";
import { CONTENT_TYPE, HTTP_STATUS } from "../constants/http.js";
import {
  MCP_AUTHORIZATION_HEADER,
  MCP_BEARER_PREFIX,
  MCP_LOOPBACK_HOSTNAMES,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from "../constants/mcp.js";
import type { AnyMcpToolDefinition } from "./define-tool.js";
import { buildToolDefinitions } from "./tool-definitions.js";
import type { AiMcpServerDeps } from "./types.js";

interface ConversationBinding {
  conversationId: string;
  token: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

/**
 * Per-conversation MCP endpoints for providers that consume MCP over HTTP.
 * One server instance per conversation, addressed by a bearer token, because
 * the protocol carries no conversation identity down to the tool handlers.
 */
export interface McpHttpRegistry {
  register(deps: AiMcpServerDeps): Promise<string>;
  release(conversationId: string): Promise<void>;
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
  dispose(): Promise<void>;
}

function registerDefinition(
  server: McpServer,
  definition: AnyMcpToolDefinition,
): void {
  server.registerTool(
    definition.name,
    { description: definition.description, inputSchema: definition.schema },
    definition.handler as never,
  );
}

async function buildServer(deps: AiMcpServerDeps): Promise<McpServer> {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });
  for (const definition of buildToolDefinitions(deps)) {
    registerDefinition(server, definition);
  }
  return server;
}

function readBearerToken(req: IncomingMessage): string | null {
  const header = req.headers[MCP_AUTHORIZATION_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return null;
  if (!value.toLowerCase().startsWith(MCP_BEARER_PREFIX)) return null;
  return value.slice(MCP_BEARER_PREFIX.length).trim();
}

function isLoopbackHostname(value: string | undefined): boolean {
  if (value === undefined) return false;
  const withoutScheme = value.replace(/^https?:\/\//, "");
  const hostname = withoutScheme.replace(/:\d+$/, "");
  return MCP_LOOPBACK_HOSTNAMES.includes(hostname);
}

// Host must be loopback; Origin, when the caller sends one, must be too.
function isLoopbackRequest(req: IncomingMessage): boolean {
  if (!isLoopbackHostname(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return isLoopbackHostname(origin);
}

function tokensMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sendError(res: ServerResponse, status: number, error: string): void {
  const body = JSON.stringify({ error });
  res.writeHead(status, {
    "Content-Type": CONTENT_TYPE.JSON,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function createMcpHttpRegistry(): McpHttpRegistry {
  const byConversation = new Map<string, ConversationBinding>();

  function resolve(token: string): ConversationBinding | null {
    let matched: ConversationBinding | null = null;
    for (const binding of byConversation.values()) {
      if (tokensMatch(token, binding.token)) matched = binding;
    }
    return matched;
  }

  async function closeBinding(binding: ConversationBinding): Promise<void> {
    await binding.transport.close();
    await binding.server.close();
  }

  return {
    async register(deps) {
      await this.release(deps.conversationId);
      const server = await buildServer(deps);
      // Session-backed: the transport instance is long-lived (one per
      // conversation), so it needs a session to correlate the handshake's
      // follow-up notifications. JSON responses keep the endpoint usable
      // without an SSE stream.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
      });
      await server.connect(transport);
      const token = randomBytes(SIDECAR_TOKEN_BYTES).toString("hex");
      byConversation.set(deps.conversationId, {
        conversationId: deps.conversationId,
        token,
        server,
        transport,
      });
      return token;
    },

    async release(conversationId) {
      const binding = byConversation.get(conversationId);
      if (binding === undefined) return;
      byConversation.delete(conversationId);
      await closeBinding(binding);
    },

    async handleRequest(req, res) {
      if (!isLoopbackRequest(req)) {
        sendError(res, HTTP_STATUS.FORBIDDEN, "non-loopback request");
        return;
      }
      const token = readBearerToken(req);
      if (token === null) {
        sendError(res, HTTP_STATUS.UNAUTHORIZED, "missing bearer token");
        return;
      }
      const binding = resolve(token);
      if (binding === null) {
        sendError(res, HTTP_STATUS.UNAUTHORIZED, "unknown bearer token");
        return;
      }
      await binding.transport.handleRequest(req, res);
    },

    async dispose() {
      const bindings = [...byConversation.values()];
      byConversation.clear();
      await Promise.all(bindings.map(closeBinding));
    },
  };
}
