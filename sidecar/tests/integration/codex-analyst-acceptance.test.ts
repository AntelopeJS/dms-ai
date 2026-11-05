import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { MOCK_CODEX_FLAG_ENV } from "../../src/constants/codex.js";
import { createMcpHttpRegistry } from "../../src/mcp/http-binding.js";
import { buildAnalystToolDefinitions } from "../../src/mcp/tool-definitions.js";
import { ensureAnalystCatalog } from "../../src/providers/codex/analyst.js";
import { createCodexAdapter } from "../../src/providers/codex/adapter.js";
import { createCodexClient } from "../../src/providers/codex/client.js";
import {
  buildConfigToml,
  buildThreadInstructions,
  buildTurnOverrides,
} from "../../src/providers/codex/config.js";
import { createCodexPermissionHandler } from "../../src/providers/codex/permissions.js";
import {
  type CodexInstallation,
  resolveCodexInstallation,
} from "../../src/providers/codex/resolve-binary.js";
import { createHttpServer } from "../../src/server/http.js";
import type { ToolDecision } from "../../src/agent/provider.js";
import { type JsonValue, JsonValueSchema } from "../../src/protocol/json.js";
import { buildInertMcpDeps } from "../helpers/provider-runner.js";
import { TURN_SETTINGS } from "../helpers/turn-settings.js";

/**
 * Proves against the real binary that an Analyst home offers the model no
 * built-in tool, and that its own tools run once the sidecar accepts Codex's
 * consent. No model is reached: Codex talks to a fake Responses endpoint that
 * records each request and refuses it or plays a scripted answer, so no
 * sign-in or plan is needed.
 * Opt-in like the Codex acceptance suite: `CODEX_ACCEPTANCE=1 pnpm
 * test:acceptance`.
 */
const INSTALLATION =
  process.env[MOCK_CODEX_FLAG_ENV] === undefined
    ? resolveCodexInstallation()
    : undefined;
const ENABLED =
  process.env.CODEX_ACCEPTANCE === "1" && INSTALLATION !== undefined;

const CONVERSATION = "conv-analyst-acceptance";
const TEST_TIMEOUT_MS = 120_000;
const EXEC_TIMEOUT_MS = 90_000;
const CAPTURE_PROVIDER = "capture";
const CAPTURE_KEY_ENV = "DMS_AI_CAPTURE_KEY";
const MCP_TOKEN_ENV = "DMS_AI_MCP_TOKEN";
/**
 * Everything an Analyst model may be offered: its question tool, Codex's three
 * MCP resource readers, which Codex adds for any configured MCP server and
 * which reach only dms-ai's (it serves no resource), and the dms-ai tools.
 */
const EXPECTED_TOOLS = [
  "functions/list_mcp_resource_templates",
  "functions/list_mcp_resources",
  "functions/read_mcp_resource",
  "functions/request_user_input",
  "mcp__dms_ai/AnalystCompute",
  "mcp__dms_ai/AnalystDescribePage",
  "mcp__dms_ai/AnalystListPages",
  "mcp__dms_ai/AnalystLoad",
  "mcp__dms_ai/AnalystReadRows",
  "mcp__dms_ai/AskUser",
];

interface CapturedTool {
  name?: string;
  type?: string;
  tools?: CapturedTool[];
}

const TOOL: z.ZodType<CapturedTool> = z.lazy(() =>
  z.object({
    name: z.string().optional(),
    type: z.string().optional(),
    tools: z.array(TOOL).optional(),
  }),
);

const RESPONSES_REQUEST = z.object({
  tools: z.array(TOOL).optional(),
  input: z
    .array(
      z.object({
        type: z.string().optional(),
        tools: z.array(TOOL).optional(),
      }),
    )
    .optional(),
});

/** Every tool offered, a namespace's members named under it. */
function leafNames(tools: readonly CapturedTool[], prefix = ""): string[] {
  return tools.flatMap((tool) => {
    const label = `${prefix}${tool.name ?? tool.type ?? "?"}`;
    if (tool.tools === undefined) return [label];
    return leafNames(tool.tools, `${label}/`);
  });
}

function offeredTools(body: string): string[] {
  const request = RESPONSES_REQUEST.parse(JSON.parse(body));
  const additional = (request.input ?? [])
    .filter((item) => item.type === "additional_tools")
    .flatMap((item) => item.tools ?? []);
  return leafNames([...(request.tools ?? []), ...additional]);
}

interface Capture {
  server: Server;
  url: string;
  bodies: string[];
}

const tcpAddressSchema = z.object({ port: z.number() });

/** What the fake Responses endpoint answers its nth request (from 0) with. */
type CaptureAnswer = (index: number) => { status: number; body: string };

const REFUSE: CaptureAnswer = () => ({
  status: 500,
  body: '{"error":{"message":"captured"}}',
});

function startCapture(answer: CaptureAnswer = REFUSE): Promise<Capture> {
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      const reply = answer(bodies.length);
      if (req.url?.includes("responses") === true) bodies.push(body);
      res.writeHead(reply.status, {
        "content-type":
          reply.status === 200 ? "text/event-stream" : "application/json",
      });
      res.end(reply.body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = tcpAddressSchema.parse(server.address());
      resolve({ server, url: `http://127.0.0.1:${port}/v1`, bodies });
    });
  });
}

/** The production Analyst config, with the model provider pointed at the capture. */
function captureConfig(config: string, captureUrl: string): string {
  return [
    config.replace(
      /^model_provider = .*$/m,
      `model_provider = "${CAPTURE_PROVIDER}"`,
    ),
    `[model_providers.${CAPTURE_PROVIDER}]`,
    `name = "${CAPTURE_PROVIDER}"`,
    `base_url = "${captureUrl}"`,
    'wire_api = "responses"',
    `env_key = "${CAPTURE_KEY_ENV}"`,
    "request_max_retries = 0",
    "stream_max_retries = 0",
    "",
  ].join("\n");
}

interface ExecRun {
  binaryPath: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * Stdin is closed: `codex exec` otherwise waits for more prompt on it. What
 * the binary printed is returned, for the failure message.
 */
function runExec(exec: ExecRun): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(exec.binaryPath, exec.args, {
      env: exec.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const keep = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGKILL"), EXEC_TIMEOUT_MS);
    child.on("close", () => {
      clearTimeout(timer);
      resolve(output);
    });
  });
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type JsonObject = Record<string, JsonValue>;

const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

interface SseEvent {
  type: string;
  [key: string]: JsonValue;
}

function sse(events: readonly SseEvent[]): string {
  return events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

const USAGE = {
  input_tokens: 1,
  input_tokens_details: null,
  output_tokens: 1,
  output_tokens_details: null,
  total_tokens: 2,
};

/** A model that calls AnalystListPages, then answers once it has the result. */
const callListPagesThenAnswer: CaptureAnswer = (index) => {
  const item =
    index === 0
      ? {
          type: "function_call",
          id: "fc_1",
          call_id: "call_list_pages",
          namespace: "mcp__dms_ai",
          name: "AnalystListPages",
          arguments: "{}",
        }
      : {
          type: "message",
          id: "msg_1",
          role: "assistant",
          content: [{ type: "output_text", text: "Done." }],
        };
  const id = `resp_${index}`;
  return {
    status: 200,
    body: sse([
      { type: "response.created", response: { id } },
      { type: "response.output_item.done", item },
      { type: "response.completed", response: { id, usage: USAGE } },
    ]),
  };
};

const completedItem = z.object({
  method: z.literal("item/completed"),
  params: z.object({ item: JsonObjectSchema }),
});

const threadStarted = z.object({ thread: z.object({ id: z.string() }) });

interface AnalystHome {
  home: string;
  work: string;
  token: string;
}

/**
 * A CODEX_HOME holding the production Analyst config, its model provider
 * pointed at the capture and its MCP server at a live dms-ai endpoint.
 */
async function prepareAnalystHome(
  installation: CodexInstallation,
  capture: Capture,
): Promise<AnalystHome> {
  cleanups.push(
    () => new Promise((done) => capture.server.close(() => done())),
  );
  const root = await mkdtemp(join(tmpdir(), "dms-ai-analyst-real-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const registry = createMcpHttpRegistry();
  const sidecar = await createHttpServer({
    clientToken: "acceptance-credential",
    port: 0,
    mcpHttpRegistry: registry,
  });
  cleanups.push(async () => {
    await registry.dispose();
    await new Promise<void>((done) => sidecar.server.close(() => done()));
  });
  const token = await registry.register(
    buildInertMcpDeps(CONVERSATION),
    buildAnalystToolDefinitions,
  );
  const home = join(root, "home");
  const work = join(root, "work");
  await mkdir(home, { recursive: true });
  await mkdir(work, { recursive: true });
  const config = buildConfigToml({
    mcpUrl: `http://127.0.0.1:${sidecar.port}/mcp`,
    hostProjectRoot: work,
    moduleRoots: [],
    nodePath: process.execPath,
    analystCatalogPath: await ensureAnalystCatalog(
      join(root, "state"),
      installation,
    ),
  });
  await writeFile(
    join(home, "config.toml"),
    captureConfig(config, capture.url),
  );
  return { home, work, token };
}

describe.skipIf(!ENABLED)("Analyst on the real Codex binary", () => {
  it(
    "offers the model no built-in tool: only its question tool and what reaches the dms-ai MCP server",
    async () => {
      if (INSTALLATION === undefined) throw new Error("no Codex installation");
      const capture = await startCapture();
      const { home, work, token } = await prepareAnalystHome(
        INSTALLATION,
        capture,
      );

      const output = await runExec({
        binaryPath: INSTALLATION.binaryPath,
        args: [
          "exec",
          "--strict-config",
          "--ephemeral",
          "--skip-git-repo-check",
          "-C",
          work,
          "How many open orders are there?",
        ],
        env: {
          ...process.env,
          CODEX_HOME: home,
          [CAPTURE_KEY_ENV]: "capture",
          [MCP_TOKEN_ENV]: token,
        },
      });

      const [first] = capture.bodies;
      expect(first, output).toBeDefined();
      const offered = offeredTools(first ?? "{}");
      console.log(`[analyst acceptance] offered tools: ${offered.join(", ")}`);
      expect([...offered].sort()).toEqual(EXPECTED_TOOLS);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "runs its own MCP tool once the sidecar accepts Codex's consent",
    async () => {
      if (INSTALLATION === undefined) throw new Error("no Codex installation");
      const { home, work, token } = await prepareAnalystHome(
        INSTALLATION,
        await startCapture(callListPagesThenAnswer),
      );
      const child = spawn(
        INSTALLATION.binaryPath,
        [...INSTALLATION.launchArgs, "app-server"],
        {
          env: {
            ...process.env,
            CODEX_HOME: home,
            [CAPTURE_KEY_ENV]: "capture",
            [MCP_TOKEN_ENV]: token,
          },
          stdio: ["pipe", "pipe", "ignore"],
        },
      );
      cleanups.push(async () => {
        child.kill("SIGKILL");
      });
      const adapter = createCodexAdapter();
      const decisions: ToolDecision[] = [];
      const settings = { ...TURN_SETTINGS, mode: "acceptEdits" as const };
      const permissions = createCodexPermissionHandler({
        conversationId: CONVERSATION,
        getSettings: () => settings,
        getChanges: () => [],
        hostProjectRoot: work,
        moduleRoots: [],
        getPendingMcpCalls: () => adapter.pendingMcpCalls(),
        onToolDecision: (decision) => decisions.push(decision),
        profile: "analyst",
      });
      const items: JsonObject[] = [];
      let finish = (): void => {};
      const finished = new Promise<void>((done) => {
        finish = done;
      });
      const client = createCodexClient(child.stdin, child.stdout, {
        onNotification: (notification) => {
          adapter.handle(notification);
          const item = completedItem.safeParse(notification);
          if (item.success) items.push(item.data.params.item);
          if (notification.method === "turn/completed") finish();
        },
        onServerRequest: (request) => permissions.handle(request),
      });
      await client.request("initialize", {
        clientInfo: { name: "acceptance", title: "acceptance", version: "0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      client.notify("initialized", {});
      const overrides = buildTurnOverrides(settings);
      const { thread } = await client.requestDecoded(
        threadStarted,
        "thread/start",
        {
          cwd: work,
          permissions: overrides.permissions,
          approvalPolicy: overrides.approvalPolicy,
          ...buildThreadInstructions(settings, "analyst"),
          ephemeral: true,
        },
      );
      await client.request("turn/start", {
        threadId: thread.id,
        input: [{ type: "text", text: "Which pages?", text_elements: [] }],
        approvalPolicy: overrides.approvalPolicy,
        permissions: overrides.permissions,
      });
      await finished;
      const call = items.find((item) => item.type === "mcpToolCall");
      expect(call).toMatchObject({ tool: "AnalystListPages", error: null });
      expect(decisions).toEqual([
        {
          callId: "call_list_pages",
          toolName: "mcp__dms-ai__AnalystListPages",
          allowedBy: "read_auto",
        },
      ]);
    },
    TEST_TIMEOUT_MS,
  );
});
