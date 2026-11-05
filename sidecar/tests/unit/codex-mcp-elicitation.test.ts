import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolDecision } from "../../src/agent/provider.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { createCodexAdapter } from "../../src/providers/codex/adapter.js";
import { createCodexPermissionHandler } from "../../src/providers/codex/permissions.js";
import type { ChatMode, TurnSettings } from "../../src/state/settings-types.js";
import type { JsonValue } from "../../src/protocol/json.js";
import type { AssistantMode } from "../../src/state/assistant-mode.js";
import { createTestBus } from "../helpers/permission-bus.js";
import { TURN_SETTINGS } from "../helpers/turn-settings.js";

beforeAll(() => setBuilderAvailable(true));
afterAll(() => setBuilderAvailable(false));

const ELICITATION_METHOD = "mcpServer/elicitation/request";
const DMS_AI_SERVER = "dms-ai";
const OTHER_SERVER = "other";
const ACCEPTED = { action: "accept", content: {}, _meta: null };
const DECLINED = { action: "decline", content: null, _meta: null };

interface StartedCall {
  id: string;
  server: string;
  tool: string;
  arguments: Record<string, string>;
}

function setup(
  settings: TurnSettings,
  calls: StartedCall[],
  profile?: AssistantMode,
) {
  const adapter = createCodexAdapter();
  for (const call of calls) {
    adapter.handle({
      method: "item/started",
      params: {
        item: { type: "mcpToolCall", status: "inProgress", ...call },
      },
    });
  }
  const { bus } = createTestBus();
  const requestPermission = vi.spyOn(bus, "requestPermission");
  const decisions: ToolDecision[] = [];
  const handler = createCodexPermissionHandler({
    conversationId: "conv-elicit",
    permissionBus: bus,
    getSettings: () => settings,
    getChanges: () => [],
    hostProjectRoot: "/srv/app",
    moduleRoots: [],
    getPendingMcpCalls: () => adapter.pendingMcpCalls(),
    onToolDecision: (decision) => decisions.push(decision),
    profile,
  });
  return { handler, decisions, requestPermission };
}

/** The consent Codex sends before an MCP tool call, as captured from the app-server. */
function toolConsent(
  serverName: string,
  tool: string,
  toolParams: Record<string, string>,
) {
  return {
    id: 7,
    method: ELICITATION_METHOD,
    params: {
      threadId: "thread",
      turnId: "turn",
      serverName,
      mode: "form",
      _meta: {
        codex_approval_kind: "mcp_tool_call",
        persist: ["session", "always"],
        tool_params: toolParams,
      },
      message: `Allow the ${serverName} MCP server to run tool "${tool}"?`,
      requestedSchema: { type: "object", properties: {} },
    },
  };
}

function elicitation(params: Record<string, JsonValue>) {
  return {
    id: 8,
    method: ELICITATION_METHOD,
    params: { threadId: "thread", turnId: null, _meta: null, ...params },
  };
}

const PAGE_CALL = {
  id: "call_page",
  server: DMS_AI_SERVER,
  tool: "GetCurrentPage",
  arguments: {},
};
const DELETE_CALL = {
  id: "call_delete",
  server: DMS_AI_SERVER,
  tool: "BuilderDeletePage",
  arguments: { pageRef: "/about" },
};
const CREATE_CALL = {
  id: "call_create",
  server: DMS_AI_SERVER,
  tool: "BuilderCreatePage",
  arguments: { route: "/new" },
};
const OTHER_CALL = {
  id: "call_other",
  server: OTHER_SERVER,
  tool: "BuilderDeletePage",
  arguments: { pageRef: "/about" },
};

const ANALYST_CALL = {
  id: "call_rows",
  server: DMS_AI_SERVER,
  tool: "AnalystReadRows",
  arguments: { tableId: "orders" },
};

const MODES: ChatMode[] = ["normal", "acceptEdits", "plan"];
const SCOPES = ["vibe", "safe"] as const;
const CELLS = MODES.flatMap((mode) =>
  SCOPES.map((generationMode) => ({ mode, generationMode })),
);

describe("a dms-ai tool's call consent", () => {
  it.each(CELLS)(
    "is accepted in $mode, $generationMode, for a read and a Builder write",
    async (cell) => {
      const settings = { ...TURN_SETTINGS, ...cell };
      const { handler, decisions } = setup(settings, [PAGE_CALL, CREATE_CALL]);
      expect(
        await handler.handle(toolConsent(DMS_AI_SERVER, "GetCurrentPage", {})),
      ).toEqual(ACCEPTED);
      expect(
        await handler.handle(
          toolConsent(
            DMS_AI_SERVER,
            "BuilderCreatePage",
            CREATE_CALL.arguments,
          ),
        ),
      ).toEqual(ACCEPTED);
      expect(decisions).toEqual([
        {
          callId: "call_page",
          toolName: "mcp__dms-ai__GetCurrentPage",
          allowedBy: "read_auto",
        },
        {
          callId: "call_create",
          toolName: "mcp__dms-ai__BuilderCreatePage",
          allowedBy: "builder_auto",
        },
      ]);
    },
  );

  it("leaves a deletion to the gate in the tool instead of asking twice", async () => {
    const { handler, decisions, requestPermission } = setup(TURN_SETTINGS, [
      DELETE_CALL,
    ]);
    const consent = toolConsent(
      DMS_AI_SERVER,
      "BuilderDeletePage",
      DELETE_CALL.arguments,
    );
    expect(await handler.handle(consent)).toEqual(ACCEPTED);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(decisions).toEqual([
      {
        callId: "call_delete",
        toolName: "mcp__dms-ai__BuilderDeletePage",
        allowedBy: "builder_auto",
      },
    ]);
  });

  it("pairs the consent with the call whose arguments it carries", async () => {
    const { handler, decisions } = setup(TURN_SETTINGS, [
      CREATE_CALL,
      PAGE_CALL,
    ]);
    await handler.handle(
      toolConsent(DMS_AI_SERVER, "BuilderCreatePage", CREATE_CALL.arguments),
    );
    expect(decisions.map((decision) => decision.callId)).toEqual([
      "call_create",
    ]);
  });
});

describe("an elicitation the sidecar declines", () => {
  it("declines another server's tool, even one named like a dms-ai tool", async () => {
    const { handler, decisions } = setup(TURN_SETTINGS, [OTHER_CALL]);
    const consent = toolConsent(
      OTHER_SERVER,
      "BuilderDeletePage",
      OTHER_CALL.arguments,
    );
    expect(await handler.handle(consent)).toEqual(DECLINED);
    expect(decisions).toEqual([
      {
        callId: "call_other",
        toolName: "mcp__other__BuilderDeletePage",
        allowedBy: "blocked",
      },
    ]);
  });

  it("declines a dms-ai consent once the turn is interrupted", async () => {
    const { handler, decisions } = setup(TURN_SETTINGS, [PAGE_CALL]);
    handler.cancelPending();
    expect(
      await handler.handle(toolConsent(DMS_AI_SERVER, "GetCurrentPage", {})),
    ).toEqual(DECLINED);
    expect(decisions).toEqual([]);
  });

  it("declines a consent no started call matches", async () => {
    const { handler } = setup(TURN_SETTINGS, []);
    expect(
      await handler.handle(toolConsent(DMS_AI_SERVER, "GetCurrentPage", {})),
    ).toEqual(DECLINED);
  });

  it.each<{ label: string; params: Record<string, JsonValue> }>([
    {
      label: "a form with fields",
      params: {
        mode: "form",
        message: "Which page?",
        requestedSchema: {
          type: "object",
          properties: { page: { type: "string" } },
        },
      },
    },
    {
      label: "a form tagged as a tool call that still asks for a field",
      params: {
        mode: "form",
        message: "Allow?",
        _meta: { codex_approval_kind: "mcp_tool_call", tool_params: {} },
        requestedSchema: {
          type: "object",
          properties: { reason: { type: "string" } },
        },
      },
    },
    {
      label: "an OpenAI form",
      params: { mode: "openai/form", message: "Fill", requestedSchema: {} },
    },
    {
      label: "an OpenAI form, camel-cased",
      params: { mode: "openaiForm", message: "Fill", requestedSchema: {} },
    },
    {
      label: "a URL",
      params: {
        mode: "url",
        message: "Open",
        url: "https://example.com",
        elicitationId: "e1",
      },
    },
    {
      label: "a user verification",
      params: {
        mode: "openai/userVerification",
        title: "Verify",
        description: "Confirm it is you",
        challenge: "c",
      },
    },
  ])("declines $label from dms-ai's own server", async ({ params }) => {
    const { handler, decisions } = setup(TURN_SETTINGS, [PAGE_CALL]);
    expect(
      await handler.handle(
        elicitation({ serverName: DMS_AI_SERVER, ...params }),
      ),
    ).toEqual(DECLINED);
    expect(decisions).toEqual([]);
  });
});

describe("an Analyst session's call consent", () => {
  it.each(CELLS)(
    "accepts its own data tool in $mode, $generationMode",
    async (cell) => {
      const settings = { ...TURN_SETTINGS, ...cell };
      const { handler, decisions } = setup(settings, [ANALYST_CALL], "analyst");
      expect(
        await handler.handle(
          toolConsent(DMS_AI_SERVER, "AnalystReadRows", ANALYST_CALL.arguments),
        ),
      ).toEqual(ACCEPTED);
      expect(decisions).toEqual([
        {
          callId: "call_rows",
          toolName: "mcp__dms-ai__AnalystReadRows",
          allowedBy: "read_auto",
        },
      ]);
    },
  );

  it("declines a dms-ai tool that is not Analyst's, which Builder would run", async () => {
    const { handler, decisions } = setup(
      TURN_SETTINGS,
      [PAGE_CALL, CREATE_CALL],
      "analyst",
    );
    expect(
      await handler.handle(toolConsent(DMS_AI_SERVER, "GetCurrentPage", {})),
    ).toEqual(DECLINED);
    expect(
      await handler.handle(
        toolConsent(DMS_AI_SERVER, "BuilderCreatePage", CREATE_CALL.arguments),
      ),
    ).toEqual(DECLINED);
    expect(decisions.map((decision) => decision.allowedBy)).toEqual([
      "blocked",
      "blocked",
    ]);
  });

  it("declines a command approval without asking, even in Ask first", async () => {
    const { handler, requestPermission } = setup(
      { ...TURN_SETTINGS, mode: "normal", generationMode: "vibe" },
      [],
      "analyst",
    );
    expect(
      await handler.handle({
        id: 9,
        method: "item/commandExecution/requestApproval",
        params: { command: "cat .env", itemId: "item-1" },
      }),
    ).toEqual({ decision: "decline" });
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
