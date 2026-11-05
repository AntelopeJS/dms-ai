import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  isJSONRPCRequest,
  type JSONRPCMessage,
  type JSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ASK_USER_TOOL_NAME,
  PROJECT_CONVERSATION_ID,
} from "../constants/mcp.js";
import { PREVIEW_BLOCKS_TOOL_NAME } from "../constants/preview.js";
import type { HostCommandSender } from "../server/host-command-router.js";
import type { IdleShutdownController } from "../server/idle-shutdown.js";
import type { AnyMcpToolDefinition } from "./define-tool.js";
import { buildMcpServer } from "./http-binding.js";
import { buildToolDefinitions } from "./tool-definitions.js";
import { createRepeatConfirmationGate } from "./tools/repeat-confirmation-gate.js";
import type { AiMcpServerStaticDeps } from "./types.js";

/** Tools that only render inside the dashboard chat, which an outside session has not got. */
const CHAT_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  ASK_USER_TOOL_NAME,
  PREVIEW_BLOCKS_TOOL_NAME,
]);

/**
 * The project's MCP endpoint, for an agent session started outside the
 * dashboard chat (a Claude Code terminal in the project). It answers one
 * JSON-RPC message at a time and keeps no session, so any number of sessions,
 * and a session that outlives a sidecar restart, share it.
 */
export interface ProjectMcpEndpoint {
  /** The response to a request; `undefined` for a notification or a response. */
  handle(message: JSONRPCMessage): Promise<JSONRPCMessage | undefined>;
}

export interface ProjectMcpEndpointDeps {
  mcpDeps: AiMcpServerStaticDeps;
  sendToHost: HostCommandSender;
  idleController: IdleShutdownController;
}

function isReplyTo(request: JSONRPCRequest, message: JSONRPCMessage): boolean {
  return "id" in message && message.id === request.id && !("method" in message);
}

async function answer(
  definitions: AnyMcpToolDefinition[],
  request: JSONRPCRequest,
): Promise<JSONRPCMessage> {
  const server = buildMcpServer(definitions);
  const [client, side] = InMemoryTransport.createLinkedPair();
  const reply = new Promise<JSONRPCMessage>((resolve) => {
    client.onmessage = (message) => {
      if (isReplyTo(request, message)) resolve(message);
    };
  });
  await server.connect(side);
  await client.send(request);
  try {
    return await reply;
  } finally {
    await server.close();
  }
}

function buildDefinitions(
  deps: ProjectMcpEndpointDeps,
): AnyMcpToolDefinition[] {
  const unavailable = () => {
    throw new Error("Not available outside the dashboard chat.");
  };
  return buildToolDefinitions({
    ...deps.mcpDeps,
    conversationId: PROJECT_CONVERSATION_ID,
    sendToHost: deps.sendToHost,
    requestQuestion: unavailable,
    getLastEditedFile: () => undefined,
    showPreview: unavailable,
    listAttachedImages: () => [],
    gateBuilderOp: createRepeatConfirmationGate(),
  }).filter((definition) => !CHAT_ONLY_TOOL_NAMES.has(definition.name));
}

/**
 * Each request is answered by a fresh server over an in-memory pair, so two
 * sessions' request ids never meet. A request holds the sidecar awake while it
 * runs: a mapping can outlast the idle timeout.
 */
export function createProjectMcpEndpoint(
  deps: ProjectMcpEndpointDeps,
): ProjectMcpEndpoint {
  const definitions = buildDefinitions(deps);
  return {
    async handle(message) {
      if (!isJSONRPCRequest(message)) return undefined;
      deps.idleController.increment();
      try {
        return await answer(definitions, message);
      } finally {
        deps.idleController.decrement();
      }
    },
  };
}
