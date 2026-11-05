import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ANALYST_ROW_CAP } from "../../src/constants/analyst.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { createAnalystMcpServer } from "../../src/mcp/sdk-binding.js";
import type { AiMcpServerDeps } from "../../src/mcp/types.js";
import type { ProviderSessionContext } from "../../src/agent/provider.js";
import { TURN_SETTINGS } from "../helpers/turn-settings.js";
import { buildAnalystSessionOptions } from "../../src/providers/claude/analyst-options.js";
import type { ProviderConfig } from "../../src/providers/claude/provider.js";
import {
  analystDeps as buildDeps,
  type Call,
  callTool,
  GRANT,
  rowsClient,
  withClient,
} from "../helpers/analyst-server.js";

const RowsAnswerSchema = z.looseObject({
  rows: z.array(z.unknown()).optional(),
  total: z.number().optional(),
  isPartial: z.boolean().optional(),
});

async function readRows(
  deps: AiMcpServerDeps,
  args: Parameters<typeof callTool>[2],
) {
  return withClient(createAnalystMcpServer(deps), async (client) => {
    const answer = await callTool(client, "AnalystReadRows", {
      page: "/sales",
      table: "orders",
      ...args,
    });
    return {
      isError: answer.isError,
      body: RowsAnswerSchema.parse(answer.body),
    };
  });
}

describe("Analyst's MCP server", () => {
  it("offers its data tools and AskUser, even with the Builder present", async () => {
    const names = await withClient(
      createAnalystMcpServer(buildDeps(rowsClient(0, []))),
      async (client) => (await client.listTools()).tools.map((t) => t.name),
    );
    expect(names.sort()).toEqual(
      [
        "AnalystCompute",
        "AnalystDescribePage",
        "AnalystListPages",
        "AnalystLoad",
        "AnalystReadRows",
        "AskUser",
      ].sort(),
    );
  });

  it("reads with the grant of whoever asked for the turn", async () => {
    const calls: Call[] = [];
    await readRows(buildDeps(rowsClient(3, calls)), {});
    expect(calls.map((call) => call.grant)).toEqual([GRANT]);
  });

  it("reads nothing when no user is attached to the turn", async () => {
    const calls: Call[] = [];
    const answer = await readRows(
      buildDeps(rowsClient(3, calls), { grant: null }),
      {},
    );
    expect(calls).toEqual([]);
    expect(answer.isError).toBe(true);
  });

  it("pages up to the cap and says the answer is partial past it", async () => {
    const calls: Call[] = [];
    const answer = await readRows(buildDeps(rowsClient(5_000, calls)), {
      limit: ANALYST_ROW_CAP,
    });
    expect(answer.body.rows).toHaveLength(ANALYST_ROW_CAP);
    expect(answer.body.total).toBe(5_000);
    expect(answer.body.isPartial).toBe(true);
    expect(calls.every((call) => Number(call.query.get("limit")) <= 100)).toBe(
      true,
    );
  });

  it("is not partial once every matching row is read", async () => {
    const answer = await readRows(buildDeps(rowsClient(120, [])), {
      limit: ANALYST_ROW_CAP,
    });
    expect(answer.body.rows).toHaveLength(120);
    expect(answer.body.isPartial).toBe(false);
  });

  it("hands filters and sorting on in the list route's syntax", async () => {
    const calls: Call[] = [];
    await readRows(buildDeps(rowsClient(1, calls)), {
      filters: [{ field: "status", mode: "is", value: "open" }],
      sortField: "total",
      sortDirection: "desc",
    });
    const [call] = calls;
    expect(call?.query.get("filter_status")).toBe("is:open");
    expect(call?.query.get("sortKey")).toBe("total");
    expect(call?.query.get("sortDirection")).toBe("desc");
  });

  it("asks for archived rows only when told to, so a table without an archive reads as before", async () => {
    const calls: Call[] = [];
    await readRows(buildDeps(rowsClient(1, calls)), { archived: "archived" });
    await readRows(buildDeps(rowsClient(1, calls)), {});
    expect(calls.map((call) => call.query.get("archived"))).toEqual([
      "archived",
      null,
    ]);
  });

  it("refuses an `archived` other than active or archived without reading", async () => {
    const calls: Call[] = [];
    const answer = await withClient(
      createAnalystMcpServer(buildDeps(rowsClient(1, calls))),
      (client) =>
        callTool(client, "AnalystReadRows", {
          page: "/sales",
          table: "orders",
          archived: "all",
        }),
    );
    expect(answer.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it("hands the backend's refusal of a filter to the model as a tool error", async () => {
    const refusal = {
      ok: false,
      status: 400,
      error: { error: "unknown_filter", detail: 'The table has no column "x"' },
    };
    const answer = await withClient(
      createAnalystMcpServer(buildDeps({ get: async () => refusal })),
      (client) =>
        callTool(client, "AnalystReadRows", {
          page: "/sales",
          table: "orders",
          filters: [{ field: "x", mode: "is", value: "1" }],
        }),
    );
    expect(answer.isError).toBe(true);
    expect(answer.body).toEqual(refusal);
  });
});

function sessionContext(decisions: string[]): ProviderSessionContext {
  return {
    conversationId: "conv-analyst",
    hostProjectRoot: "/tmp/host",
    getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
    settings: TURN_SETTINGS,
    onDisposed: () => {},
    onToolDecision: (decision) =>
      decisions.push(`${decision.toolName}:${decision.allowedBy}`),
  };
}

function toolCall(toolUseID: string): Parameters<CanUseTool>[2] {
  return {
    signal: new AbortController().signal,
    toolUseID,
    requestId: `request-${toolUseID}`,
  };
}

const CONFIG: ProviderConfig = {
  timeoutMs: 1_000,
  moduleRoots: ["/tmp/module"],
  skillDirs: [{ module: "m", dir: "/tmp/skills" }],
  buildOptions: buildAnalystSessionOptions,
};

describe("an Analyst session", () => {
  it("hands the SDK no built-in tool, no plugin, no skill and no settings from disk", async () => {
    const options = await buildAnalystSessionOptions(
      CONFIG,
      sessionContext([]),
      { settings: TURN_SETTINGS },
      new AbortController(),
    );
    expect(options.tools).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.settingSources).toEqual([]);
    expect(options.plugins).toBeUndefined();
    expect(options.skills).toBeUndefined();
    expect(options.systemPrompt).toEqual(expect.any(String));
  });

  it.each([
    "Bash",
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
    "Task",
    "mcp__dms-ai__BuilderAddBlock",
    "mcp__dms-ai__DatabaseProfile",
  ])("refuses %s", async (toolName) => {
    const decisions: string[] = [];
    const options = await buildAnalystSessionOptions(
      CONFIG,
      sessionContext(decisions),
      { settings: TURN_SETTINGS },
      new AbortController(),
    );
    const result = await options.canUseTool?.(toolName, {}, toolCall("call-1"));
    expect(result?.behavior).toBe("deny");
    expect(decisions).toEqual([`${toolName}:blocked`]);
  });

  it("lets its own tools through", async () => {
    const options = await buildAnalystSessionOptions(
      CONFIG,
      sessionContext([]),
      { settings: TURN_SETTINGS },
      new AbortController(),
    );
    const result = await options.canUseTool?.(
      "mcp__dms-ai__AnalystReadRows",
      {},
      toolCall("call-2"),
    );
    expect(result?.behavior).toBe("allow");
  });
});
