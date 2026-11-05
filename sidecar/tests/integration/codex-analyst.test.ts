import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderSession } from "../../src/agent/provider.js";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import {
  createMcpHttpRegistry,
  type McpHttpRegistry,
} from "../../src/mcp/http-binding.js";
import { ANALYST_SYSTEM_PROMPT } from "../../src/prompts/analyst.js";
import { createCodexProvider } from "../../src/providers/codex/provider.js";
import { createHttpServer } from "../../src/server/http.js";
import type { AssistantMode } from "../../src/state/assistant-mode.js";
import type { TurnSettings } from "../../src/state/settings-types.js";
import {
  readCodexConfig,
  readConfiguredCatalog,
} from "../helpers/codex-home.js";
import {
  CODEX_FIXTURE,
  codexTurns,
  readCodexTrace,
  traceCodexInto,
} from "../helpers/provider-fixtures.js";
import { CODEX_READ_ONLY_PROFILE } from "../../src/providers/codex/permission-profiles.js";
import { buildInertMcpDeps } from "../helpers/provider-runner.js";
import { TURN_SETTINGS } from "../helpers/turn-settings.js";

const CONVERSATION = "conv-codex-analyst";
const TEST_TIMEOUT_MS = 30_000;
const COMMAND_TURN = "q1b-readonly-command-no-write.jsonl";
const SIMPLE_TURN = "recette-1-simple-message.jsonl";
const ACCEPT_EDITS: TurnSettings = { ...TURN_SETTINGS, mode: "acceptEdits" };

interface Harness {
  dir: string;
  stateDir: string;
  trace: string;
  server: Server;
  registry: McpHttpRegistry;
  mcpUrl: string;
  tokens: Map<string, string>;
}

let harness: Harness | undefined;
const sessions: ProviderSession[] = [];

/** The real registry, remembering each conversation's bearer token. */
function recordTokens(
  registry: McpHttpRegistry,
  tokens: Map<string, string>,
): McpHttpRegistry {
  return {
    ...registry,
    register: async (deps, definitions) => {
      const token = await registry.register(deps, definitions);
      tokens.set(deps.conversationId, token);
      return token;
    },
  };
}

async function startHarness(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "dms-ai-codex-analyst-"));
  const registry = createMcpHttpRegistry();
  const { server, port } = await createHttpServer({
    clientToken: "integration-test-credential",
    port: 0,
    mcpHttpRegistry: registry,
  });
  const trace = join(dir, "trace.jsonl");
  traceCodexInto(trace);
  return {
    dir,
    stateDir: join(dir, ".state"),
    trace,
    server,
    registry,
    mcpUrl: `http://127.0.0.1:${port}/mcp`,
    tokens: new Map(),
  };
}

const disposals: Array<Promise<void>> = [];

async function openSession(
  profile: AssistantMode,
  settings: TurnSettings = TURN_SETTINGS,
): Promise<ProviderSession> {
  if (harness === undefined) throw new Error("no harness");
  const { mcpUrl } = harness;
  const provider = createCodexProvider({
    settings,
    profile,
    skillDirs: [{ module: "dms-builder", dir: join(harness.dir, "skills") }],
    stateDir: harness.stateDir,
    mcpHttpRegistry: recordTokens(harness.registry, harness.tokens),
    createMcpDeps: buildInertMcpDeps,
    getMcpUrl: () => mcpUrl,
  });
  const session = await provider.createSession({
    conversationId: CONVERSATION,
    hostProjectRoot: harness.dir,
    getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
    settings,
    onDisposed: (disposal) => disposals.push(disposal),
  });
  sessions.push(session);
  return session;
}

async function runTurn(
  session: ProviderSession,
  settings: TurnSettings = TURN_SETTINGS,
): Promise<RunnerEvent[]> {
  const events: RunnerEvent[] = [];
  for await (const event of session.runTurn(
    { text: "How many orders?", attachments: [] },
    settings,
  )) {
    events.push(event);
  }
  return events;
}

function requestsOf(method: string) {
  if (harness === undefined) return [];
  return readCodexTrace(harness.trace).filter(
    (entry) => entry.kind === "request" && entry.method === method,
  );
}

async function listMcpTools(): Promise<string[]> {
  const token = harness?.tokens.get(CONVERSATION);
  if (harness === undefined || token === undefined) return [];
  const client = new Client({ name: "codex-analyst-test", version: "0.0.1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(harness.mcpUrl), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
  }
}

beforeEach(async () => {
  CODEX_FIXTURE.use("simple");
  harness = await startHarness();
});

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
  disposals.length = 0;
  if (harness !== undefined) {
    const { server, registry, dir } = harness;
    await registry.dispose();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  }
  harness = undefined;
  CODEX_FIXTURE.reset();
});

describe("an Analyst conversation on Codex", () => {
  it(
    "switches off web search and every tool feature, and reads models from a catalog that forces none on",
    async () => {
      await openSession("analyst");
      const config = await readCodexConfig(
        harness?.stateDir ?? "",
        CONVERSATION,
      );
      expect(config).toContain('web_search = "disabled"');
      expect(config).toMatch(/\[features\][^[]*shell_tool = false/);
      expect(config).toMatch(/\[features\][^[]*multi_agent_v2 = false/);
      expect(config).toMatch(/\[features\][^[]*code_mode_host = false/);
      expect(config.indexOf("model_catalog_json")).toBeLessThan(
        config.indexOf("["),
      );
      const [model] = await readConfiguredCatalog(config);
      expect(model).toEqual({
        slug: "mock-model",
        display_name: "Mock model",
        experimental_supported_tools: [],
        supports_search_tool: false,
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "leaves a Builder conversation's tools as Codex has them",
    async () => {
      await openSession("builder");
      const config = await readCodexConfig(
        harness?.stateDir ?? "",
        CONVERSATION,
      );
      expect(config).not.toContain("web_search");
      expect(config).not.toContain("[features]");
      expect(config).not.toContain("model_catalog_json");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "starts the thread on the Analyst prompt and keeps every turn read-only whatever the chat mode",
    async () => {
      const session = await openSession("analyst", ACCEPT_EDITS);
      await runTurn(session, ACCEPT_EDITS);
      const [threadStart] = requestsOf("thread/start");
      expect(threadStart?.params).toMatchObject({
        baseInstructions: ANALYST_SYSTEM_PROMPT,
        permissions: CODEX_READ_ONLY_PROFILE,
        approvalPolicy: "on-request",
      });
      expect(threadStart?.params).not.toHaveProperty("developerInstructions");
      const [turnStart] = requestsOf("turn/start");
      expect(turnStart?.params).toMatchObject({
        permissions: CODEX_READ_ONLY_PROFILE,
        approvalPolicy: "on-request",
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "loads none of the module skills and disables every skill Codex lists",
    async () => {
      await openSession("analyst");
      expect(requestsOf("skills/extraRoots/set")).toEqual([]);
      expect(
        requestsOf("skills/config/write").map((entry) => entry.params),
      ).toEqual([expect.objectContaining({ enabled: false })]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "serves only the Analyst tools and AskUser on its MCP endpoint",
    async () => {
      await openSession("analyst");
      expect(await listMcpTools()).toEqual([
        "AnalystCompute",
        "AnalystDescribePage",
        "AnalystListPages",
        "AnalystLoad",
        "AnalystReadRows",
        "AskUser",
      ]);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("the Analyst guard on Codex", () => {
  it(
    "fails an Analyst turn in which Codex runs a shell command, and drops the session so no later turn sees its output",
    async () => {
      process.env.MOCK_CODEX_SCRIPT = codexTurns(COMMAND_TURN);
      const session = await openSession("analyst");
      const events = await runTurn(session);
      const errors = events.flatMap((event) =>
        event.type === "error" ? [event.message] : [],
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("commandExecution");
      expect(events.some((event) => event.type === "tool_use")).toBe(false);
      expect(disposals).toHaveLength(1);
      await disposals[0];
      process.env.MOCK_CODEX_SCRIPT = codexTurns(SIMPLE_TURN);
      const next = await openSession("analyst");
      expect(requestsOf("thread/start")).toHaveLength(2);
      const after = await runTurn(next);
      expect(after.some((event) => event.type === "error")).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "lets the same command through on a Builder turn",
    async () => {
      process.env.MOCK_CODEX_SCRIPT = codexTurns(COMMAND_TURN);
      const session = await openSession("builder");
      const events = await runTurn(session);
      expect(events.some((event) => event.type === "error")).toBe(false);
      expect(events).toContainEqual(
        expect.objectContaining({ type: "tool_use", toolName: "Bash" }),
      );
      expect(requestsOf("turn/interrupt")).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
