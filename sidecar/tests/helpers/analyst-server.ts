import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AnalystClient } from "../../src/analyst/analyst-client.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import type { AiMcpServerDeps } from "../../src/mcp/types.js";
import { type JsonValue, JsonValueSchema } from "../../src/protocol/json.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";

export const GRANT = "grant-of-ada";

export interface Call {
  path: string;
  query: URLSearchParams;
  grant: string;
}

type Row = { [key: string]: JsonValue };

/** A rows route over `total` rows, `rowAt(i)` each, logging every request. */
export function rowsClient(
  total: number,
  calls: Call[],
  rowAt: (index: number) => Row = (index) => ({ _id: String(index) }),
): AnalystClient {
  return {
    get: async (path, query, grant) => {
      calls.push({ path, query, grant });
      const offset = Number(query.get("offset"));
      const limit = Number(query.get("limit"));
      const count = Math.max(0, Math.min(limit, total - offset));
      const rows = Array.from({ length: count }, (_, i) => rowAt(offset + i));
      return { rows, total, offset, limit };
    },
  };
}

export function analystDeps(
  analystClient: AnalystClient,
  options: { grant?: string | null; conversationId?: string } = {},
): AiMcpServerDeps {
  const grant = options.grant === undefined ? GRANT : options.grant;
  return {
    getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
    registry: {
      getRegistry: async () => [],
      getStaleSinceMs: () => null,
      invalidate: () => {},
    },
    scanner: {
      scan: async () => ({ importersByFile: new Map() }),
      invalidate: () => {},
    },
    hostProjectRoot: "/tmp/host",
    moduleRoots: [],
    logsClient: { getLogs: async () => [] },
    builderClient: { call: async () => null },
    databaseClient: { get: async () => [], post: async () => ({}) },
    analystClient,
    builderEnabled: true,
    sendToHost: () => {},
    navigationCompleter: createNavigationCompleter(),
    conversationId: options.conversationId ?? "conv-analyst",
    requestQuestion: async () => null,
    getLastEditedFile: () => undefined,
    showPreview: () => {},
    listAttachedImages: () => [],
    currentGrant: () => grant ?? undefined,
  };
}

export async function withClient<T>(
  server: { instance: McpServer },
  use: (client: Client) => Promise<T>,
): Promise<T> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await server.instance.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await use(client);
  } finally {
    await client.close();
  }
}

const ToolAnswerSchema = z.object({
  content: z.tuple([z.object({ text: z.string() })]),
});

type ToolArguments = Parameters<Client["callTool"]>[0]["arguments"];

function parseBody(text: string): JsonValue {
  try {
    return JsonValueSchema.parse(JSON.parse(text));
  } catch {
    return text;
  }
}

/** One tool call: whether it failed, its raw text and that text as JSON when it is. */
export async function callTool(
  client: Client,
  name: string,
  args: ToolArguments,
) {
  const result = await client.callTool({ name, arguments: args });
  const [content] = ToolAnswerSchema.parse(result).content;
  return {
    isError: result.isError === true,
    text: content.text,
    body: parseBody(content.text),
  };
}
