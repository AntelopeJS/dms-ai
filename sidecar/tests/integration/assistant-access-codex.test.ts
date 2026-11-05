import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { ANALYST_SYSTEM_PROMPT } from "../../src/prompts/analyst.js";
import {
  CLAUDE_FIXTURE,
  CODEX_FIXTURE,
  readClaudeTrace,
  readCodexTrace,
  traceClaudeInto,
  traceCodexInto,
} from "../helpers/provider-fixtures.js";
import {
  createCollector,
  isTerminal,
  openChat,
  sendHello,
  sendUserMessage,
  sendWire,
  startWsHarness,
  type WireCollector,
  type WsHarness,
} from "../helpers/ws-harness.js";

const CLAUDE_SCRIPT = resolve(
  import.meta.dirname,
  "../fixtures/mock-claude/scripts/answer.json",
);
const WAIT_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 30_000;

interface Chat {
  client: WebSocket;
  collector: WireCollector;
}

interface Traces {
  codex: string;
  claude: string;
}

let harness: WsHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
  CODEX_FIXTURE.reset();
  CLAUDE_FIXTURE.reset();
});

async function start(): Promise<{ harness: WsHarness; traces: Traces }> {
  CODEX_FIXTURE.use("simple");
  CLAUDE_FIXTURE.use("simple");
  process.env.MOCK_CLAUDE_SCRIPT = CLAUDE_SCRIPT;
  const dir = await mkdtemp(join(tmpdir(), "analyst-codex-trace-"));
  const traces = { codex: join(dir, "codex"), claude: join(dir, "claude") };
  traceCodexInto(traces.codex);
  traceClaudeInto(traces.claude);
  harness = await startWsHarness({ provider: "codex", isDevelopment: false });
  return { harness, traces };
}

async function connectAnalyst(port: number): Promise<Chat> {
  const client = await openChat(port);
  const collector = createCollector(client, WAIT_TIMEOUT_MS);
  sendWire(client, {
    type: "actor",
    userId: "ada",
    name: "ada",
    tenantId: "default",
    isOwner: false,
    modes: ["analyst"],
    grant: "grant-ada",
  });
  return { client, collector };
}

async function runTurn(chat: Chat, conversationId: string): Promise<string> {
  const before = chat.collector.events.filter(isTerminal).length;
  sendHello(chat.client, conversationId);
  sendUserMessage(chat.client, conversationId, "How many open orders?");
  const end = await chat.collector.next(
    (e) =>
      isTerminal(e) &&
      e.conversationId === conversationId &&
      chat.collector.events.filter(isTerminal).length > before,
  );
  return end.type;
}

function analystThreadStarts(trace: string): unknown[] {
  return readCodexTrace(trace)
    .filter((e) => e.kind === "request" && e.method === "thread/start")
    .map((e) => e.params?.baseInstructions);
}

describe("Analyst on the Codex provider", () => {
  it(
    "runs on Codex when Codex is the provider, on the Analyst prompt, and records Codex as what answered",
    async () => {
      const { harness: started, traces } = await start();
      const ada = await connectAnalyst(started.port);
      expect(await runTurn(ada, "c-codex")).toBe("run_done");
      expect(analystThreadStarts(traces.codex)).toEqual([
        ANALYST_SYSTEM_PROMPT,
      ]);
      expect(readClaudeTrace(traces.claude)).toEqual([]);
      expect(started.conversationStore.get("c-codex")?.provider).toBe("codex");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "moves to Claude with the provider setting, retiring the Codex session",
    async () => {
      const { harness: started, traces } = await start();
      const ada = await connectAnalyst(started.port);
      expect(await runTurn(ada, "c-switch")).toBe("run_done");
      const next = {
        ...started.settingsStore.get(),
        provider: "claude" as const,
      };
      started.settingsStore.set(next);
      started.bridge.services?.runner.applySettings(next);
      expect(await runTurn(ada, "c-switch")).toBe("run_done");
      expect(analystThreadStarts(traces.codex)).toHaveLength(1);
      const sessions = readClaudeTrace(traces.claude).filter(
        (e) => e.kind === "session",
      );
      expect(sessions.map((s) => s.tools)).toEqual([[]]);
      expect(started.conversationStore.get("c-switch")?.provider).toBe(
        "claude",
      );
    },
    TEST_TIMEOUT_MS,
  );
});
