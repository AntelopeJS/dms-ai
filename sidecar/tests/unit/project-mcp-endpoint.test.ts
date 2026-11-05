import type {
  JSONRPCMessage,
  JSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { DATABASE_CONNECTIONS_TOOL_NAME } from "../../src/constants/database.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import {
  ASK_USER_TOOL_NAME,
  NAVIGATE_TOOL_NAME,
} from "../../src/constants/mcp.js";
import { PREVIEW_BLOCKS_TOOL_NAME } from "../../src/constants/preview.js";
import type { BuilderClient } from "../../src/builder/builder-client.js";
import { createProjectMcpEndpoint } from "../../src/mcp/project-endpoint.js";
import type { IdleShutdownController } from "../../src/server/idle-shutdown.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";

interface IdleProbe extends IdleShutdownController {
  held: number;
}

function buildIdleProbe(): IdleProbe {
  const probe: IdleProbe = {
    held: 0,
    increment: () => {
      probe.held += 1;
    },
    decrement: () => {
      probe.held -= 1;
    },
    touch: () => {},
  };
  return probe;
}

function buildEndpoint(
  builderClient: BuilderClient,
  idleController: IdleShutdownController = buildIdleProbe(),
) {
  return createProjectMcpEndpoint({
    mcpDeps: {
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
      hostProjectRoot: "/project",
      moduleRoots: [],
      logsClient: { getLogs: async () => [] },
      builderClient,
      builderEnabled: true,
      databaseClient: { get: async () => [], post: async () => ({}) },
      navigationCompleter: createNavigationCompleter(),
    },
    sendToHost: () => {},
    idleController,
  });
}

const idleBuilder: BuilderClient = { call: async () => ({ ok: true }) };

function request(
  id: number,
  method: string,
  params: JSONRPCRequest["params"] = {},
): JSONRPCRequest {
  return { jsonrpc: "2.0", id, method, params };
}

const ResultReplySchema = z.object({ result: z.looseObject({}) });
const ToolListSchema = z.object({
  tools: z.array(z.looseObject({ name: z.string() })),
});

function resultOf(reply: JSONRPCMessage | undefined) {
  return ResultReplySchema.parse(reply).result;
}

async function listToolNames(): Promise<string[]> {
  const reply = await buildEndpoint(idleBuilder).handle(
    request(1, "tools/list"),
  );
  return ToolListSchema.parse(resultOf(reply)).tools.map((tool) => tool.name);
}

describe("createProjectMcpEndpoint", () => {
  it("serves the Builder, database and navigation tools to an outside session", async () => {
    const names = await listToolNames();
    expect(names).toEqual(
      expect.arrayContaining([
        "BuilderAnalyseDatabase",
        "BuilderMapResources",
        "BuilderComposePage",
        DATABASE_CONNECTIONS_TOOL_NAME,
        NAVIGATE_TOOL_NAME,
      ]),
    );
  });

  it("leaves out the tools that only render in the dashboard chat", async () => {
    const names = await listToolNames();
    expect(names).not.toContain(ASK_USER_TOOL_NAME);
    expect(names).not.toContain(PREVIEW_BLOCKS_TOOL_NAME);
  });

  it("answers an initialize handshake without a session", async () => {
    const reply = await buildEndpoint(idleBuilder).handle(
      request(0, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      }),
    );
    expect(resultOf(reply)).toHaveProperty("serverInfo.name", "dms-ai-mcp");
  });

  it("runs a tool call through the Builder backend", async () => {
    const calls: string[] = [];
    const builder: BuilderClient = {
      call: async (op) => {
        calls.push(op);
        return { ok: true, value: [] };
      },
    };
    const reply = await buildEndpoint(builder).handle(
      request(7, "tools/call", { name: "BuilderListPages", arguments: {} }),
    );
    expect(reply).toHaveProperty("id", 7);
    expect(calls).toEqual(["ListPages"]);
  });

  it("keeps two sessions' calls apart when they reuse a request id", async () => {
    const endpoint = buildEndpoint(idleBuilder);
    const [list, ping] = await Promise.all([
      endpoint.handle(request(1, "tools/list")),
      endpoint.handle(request(1, "ping")),
    ]);
    expect(resultOf(list)).toHaveProperty("tools");
    expect(resultOf(ping)).toEqual({});
  });

  it("holds the sidecar awake while a call runs and releases it after", async () => {
    const idle = buildIdleProbe();
    let heldDuringCall = 0;
    const builder: BuilderClient = {
      call: async () => {
        heldDuringCall = idle.held;
        return { ok: true };
      },
    };
    await buildEndpoint(builder, idle).handle(
      request(1, "tools/call", { name: "BuilderListPages", arguments: {} }),
    );
    expect(heldDuringCall).toBe(1);
    expect(idle.held).toBe(0);
  });

  it("acknowledges a notification without a reply", async () => {
    const reply = await buildEndpoint(idleBuilder).handle({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(reply).toBeUndefined();
  });
});
