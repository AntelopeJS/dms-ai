import http from "node:http";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { MCP_PROJECT_MAX_BODY_BYTES } from "../../src/constants/mcp.js";
import type { ProjectMcpEndpoint } from "../../src/mcp/project-endpoint.js";
import { createHttpServer } from "../../src/server/http.js";

const CLIENT_TOKEN = "project-mcp-route-credential";
const HOST = "127.0.0.1";

interface Handle {
  port: number;
  close: () => Promise<void>;
}

/** Answers each request with an empty result, and nothing to a notification. */
const echoEndpoint: ProjectMcpEndpoint = {
  handle: async (message: JSONRPCMessage) =>
    "method" in message && "id" in message
      ? { jsonrpc: "2.0", id: message.id, result: {} }
      : undefined,
};

async function startServer(projectMcp?: ProjectMcpEndpoint): Promise<Handle> {
  const { server, port } = await createHttpServer({
    clientToken: CLIENT_TOKEN,
    port: 0,
    bridge: { projectMcp },
  });
  return {
    port,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

function post(handle: Handle, body: string, token = CLIENT_TOKEN) {
  return fetch(`http://${HOST}:${handle.port}/mcp/project`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });
}

/** Sends a declared length over the limit without the body, as an oversized caller would start. */
function postDeclaringLength(handle: Handle, length: number) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      {
        host: HOST,
        port: handle.port,
        path: "/mcp/project",
        method: "POST",
        headers: {
          Authorization: `Bearer ${CLIENT_TOKEN}`,
          "Content-Length": length,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.write("{");
  });
}

describe("POST /mcp/project", () => {
  let handle: Handle;

  afterEach(async () => {
    await handle.close();
  });

  it("refuses a caller without the client credential", async () => {
    handle = await startServer(echoEndpoint);
    const res = await post(handle, "{}", "wrong");
    expect(res.status).toBe(401);
  });

  it("answers a request with the endpoint's reply", async () => {
    handle = await startServer(echoEndpoint);
    const res = await post(
      handle,
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "ping" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: 4, result: {} });
  });

  it("acknowledges a notification with 202 and no body", async () => {
    handle = await startServer(echoEndpoint);
    const res = await post(
      handle,
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("refuses a body that is no JSON-RPC message with a JSON-RPC error", async () => {
    handle = await startServer(echoEndpoint);
    const res = await post(handle, "{ not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error.code", -32600);
  });

  it("answers an oversized body with 413 instead of resetting the connection", async () => {
    handle = await startServer(echoEndpoint);
    const answer = await postDeclaringLength(
      handle,
      MCP_PROJECT_MAX_BODY_BYTES + 1,
    );
    expect(answer.status).toBe(413);
    expect(JSON.parse(answer.body)).toHaveProperty("error.code", -32600);
  });

  it("answers 503 while the endpoint is not built yet", async () => {
    handle = await startServer(undefined);
    const res = await post(
      handle,
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    );
    expect(res.status).toBe(503);
  });
});
