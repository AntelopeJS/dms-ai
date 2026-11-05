import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type JSONRPCMessage,
  JSONRPCMessageSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { CONTENT_TYPE, HTTP_STATUS } from "../constants/http.js";
import { MCP_PROJECT_MAX_BODY_BYTES } from "../constants/mcp.js";
import type { ProjectMcpEndpoint } from "../mcp/project-endpoint.js";
import { readBody, sendJson, sendResponse } from "./http-io.js";

const INVALID_REQUEST = {
  jsonrpc: "2.0",
  error: { code: -32600, message: "Invalid Request" },
} as const;

const TOO_LARGE = {
  jsonrpc: "2.0",
  error: { code: -32600, message: "Request too large" },
} as const;

type ReadOutcome =
  | { kind: "message"; message: JSONRPCMessage }
  | { kind: "invalid" }
  | { kind: "too-large" };

/**
 * A body over the limit is refused from its declared length, before it is
 * read, so the caller gets an answer instead of a reset connection.
 */
async function readMessage(req: IncomingMessage): Promise<ReadOutcome> {
  if (Number(req.headers["content-length"]) > MCP_PROJECT_MAX_BODY_BYTES) {
    return { kind: "too-large" };
  }
  let body: string;
  try {
    body = await readBody(req, MCP_PROJECT_MAX_BODY_BYTES);
  } catch {
    return { kind: "too-large" };
  }
  try {
    const parsed = JSONRPCMessageSchema.safeParse(JSON.parse(body));
    return parsed.success
      ? { kind: "message", message: parsed.data }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

/**
 * `POST /mcp/project`, once the client credential is checked: one JSON-RPC
 * message in, its response out, 202 for a notification. Answers 503 until the
 * WebSocket stack has built the endpoint.
 */
export async function handleProjectMcp(
  req: IncomingMessage,
  res: ServerResponse,
  endpoint: ProjectMcpEndpoint | undefined,
): Promise<void> {
  if (endpoint === undefined) {
    sendJson(res, HTTP_STATUS.UNAVAILABLE, { error: "starting" });
    return;
  }
  const outcome = await readMessage(req);
  if (outcome.kind === "too-large") {
    res.setHeader("Connection", "close");
    sendJson(res, HTTP_STATUS.PAYLOAD_TOO_LARGE, TOO_LARGE);
    return;
  }
  if (outcome.kind === "invalid") {
    sendJson(res, HTTP_STATUS.BAD_REQUEST, INVALID_REQUEST);
    return;
  }
  const reply = await endpoint.handle(outcome.message);
  if (reply === undefined) {
    res.writeHead(HTTP_STATUS.ACCEPTED);
    res.end();
    return;
  }
  sendResponse(res, HTTP_STATUS.OK, CONTENT_TYPE.JSON, JSON.stringify(reply));
}
