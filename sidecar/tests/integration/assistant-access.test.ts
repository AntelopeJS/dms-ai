import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import {
  readClaudeTrace,
  traceClaudeInto,
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

const SCRIPT = resolve(
  import.meta.dirname,
  "../fixtures/mock-claude/scripts/answer.json",
);
const WAIT_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 30_000;
const QUIET_MS = 300;

interface ActorInput {
  userId: string;
  tenantId?: string;
  modes: Array<"builder" | "analyst">;
  grant?: string;
}

interface Chat {
  client: WebSocket;
  collector: WireCollector;
}

let harness: WsHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
  delete process.env.MOCK_CLAUDE;
  delete process.env.MOCK_CLAUDE_SCRIPT;
  delete process.env.MOCK_CLAUDE_TRACE;
});

async function start(isDevelopment: boolean): Promise<WsHarness> {
  process.env.MOCK_CLAUDE = "1";
  process.env.MOCK_CLAUDE_SCRIPT = SCRIPT;
  harness = await startWsHarness({ provider: "claude", isDevelopment });
  return harness;
}

async function connect(port: number, actor: ActorInput | null): Promise<Chat> {
  const client = await openChat(port);
  const collector = createCollector(client, WAIT_TIMEOUT_MS);
  if (actor !== null) {
    sendWire(client, {
      type: "actor",
      userId: actor.userId,
      name: actor.userId,
      tenantId: actor.tenantId ?? "default",
      isOwner: actor.modes.includes("builder"),
      modes: actor.modes,
      grant: actor.grant ?? `grant-${actor.userId}`,
    });
  }
  return { client, collector };
}

function quiet(): Promise<void> {
  return new Promise((done) => setTimeout(done, QUIET_MS));
}

async function runTurn(chat: Chat, conversationId: string): Promise<string> {
  sendHello(chat.client, conversationId);
  sendUserMessage(chat.client, conversationId, "How many open orders?");
  const end = await chat.collector.next(
    (e) => isTerminal(e) && e.conversationId === conversationId,
  );
  return end.type;
}

async function listedIds(chat: Chat): Promise<string[]> {
  const before = chat.collector.events.length;
  sendWire(chat.client, { type: "list_conversations" });
  const list = await chat.collector.next(
    (e) =>
      e.type === "conversation_list" &&
      chat.collector.events.indexOf(e) >= before,
  );
  return (list.conversations ?? []).map((c) => c.id ?? "");
}

async function traceFile(): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), "analyst-trace-")), "trace");
  traceClaudeInto(file);
  return file;
}

describe("the assistant in production", () => {
  it(
    "runs a new conversation as Analyst, with no built-in tool and its own prompt",
    async () => {
      const { port } = await start(false);
      const trace = await traceFile();
      const owner = await connect(port, {
        userId: "owner",
        modes: ["analyst"],
      });
      expect(await runTurn(owner, "c-prod")).toBe("run_done");
      const [session] = readClaudeTrace(trace).filter(
        (e) => e.kind === "session",
      );
      expect(session?.tools).toEqual([]);
      expect(session?.strictMcpConfig).toBe(true);
      expect(session?.systemPrompt).toEqual(expect.any(String));
      expect(session?.plugins).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses Builder even to a socket the backend did not announce",
    async () => {
      const { port, conversationStore } = await start(false);
      const tooling = await connect(port, null);
      sendWire(tooling.client, {
        type: "set_conversation_mode",
        conversationId: "c-tooling",
        assistant: "builder",
      });
      sendHello(tooling.client, "c-tooling");
      sendUserMessage(tooling.client, "c-tooling", "Edit a page");
      await quiet();
      expect(tooling.collector.events.filter(isTerminal)).toEqual([]);
      expect(conversationStore.get("c-tooling")).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a Builder turn on a conversation already in Builder",
    async () => {
      const { port, conversationStore } = await start(false);
      conversationStore.setModes("c-old", { assistant: "builder" });
      conversationStore.claim("c-old", {
        userId: "owner",
        tenantId: "default",
      });
      const owner = await connect(port, {
        userId: "owner",
        modes: ["analyst"],
      });
      expect(await runTurn(owner, "c-old")).toBe("run_error");
    },
    TEST_TIMEOUT_MS,
  );
});

describe("the assistant in development", () => {
  it(
    "keeps an Analyst user's conversations to that user, in that tenant",
    async () => {
      const { port } = await start(true);
      const ada = await connect(port, { userId: "ada", modes: ["analyst"] });
      expect(await runTurn(ada, "c-ada")).toBe("run_done");
      const grace = await connect(port, {
        userId: "grace",
        modes: ["analyst"],
      });
      const adaElsewhere = await connect(port, {
        userId: "ada",
        tenantId: "other",
        modes: ["analyst"],
      });
      const owner = await connect(port, {
        userId: "owner",
        modes: ["builder", "analyst"],
      });
      expect(await listedIds(ada)).toEqual(["c-ada"]);
      expect(await listedIds(grace)).toEqual([]);
      expect(await listedIds(adaElsewhere)).toEqual([]);
      expect(await listedIds(owner)).toEqual([]);
      sendHello(grace.client, "c-ada");
      sendUserMessage(grace.client, "c-ada", "Show me");
      await quiet();
      expect(
        grace.collector.events.some((e) => e.conversationId === "c-ada"),
      ).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "starts an Analyst user's conversation in Analyst and never lets them switch to Builder",
    async () => {
      const { port, conversationStore } = await start(true);
      const ada = await connect(port, { userId: "ada", modes: ["analyst"] });
      expect(await runTurn(ada, "c-ada")).toBe("run_done");
      sendWire(ada.client, {
        type: "set_conversation_mode",
        conversationId: "c-ada",
        assistant: "builder",
      });
      await quiet();
      expect(conversationStore.get("c-ada")?.assistant).toBe("analyst");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "leaves settings, change sets and the host browser to Builder users",
    async () => {
      const { port, settingsStore } = await start(true);
      const ada = await connect(port, { userId: "ada", modes: ["analyst"] });
      const before = settingsStore.get().claudeModel;
      sendWire(ada.client, {
        type: "set_settings",
        claudeModel: "claude-other",
      });
      sendWire(ada.client, { type: "hello", role: "host" });
      await quiet();
      expect(settingsStore.get().claudeModel).toBe(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "lets a Builder user switch a conversation to Analyst, which then opens a fresh Analyst session",
    async () => {
      const { port } = await start(true);
      const trace = await traceFile();
      const owner = await connect(port, {
        userId: "owner",
        modes: ["builder", "analyst"],
      });
      expect(await runTurn(owner, "c-switch")).toBe("run_done");
      sendWire(owner.client, {
        type: "set_conversation_mode",
        conversationId: "c-switch",
        assistant: "analyst",
      });
      await owner.collector.next(
        (e) => e.type === "conversation_mode" && e.assistant === "analyst",
      );
      sendUserMessage(owner.client, "c-switch", "And now the data?");
      await owner.collector.next(
        (e) =>
          isTerminal(e) &&
          owner.collector.events.filter(isTerminal).length >= 2,
      );
      const sessions = readClaudeTrace(trace).filter(
        (e) => e.kind === "session",
      );
      expect(sessions.map((s) => s.tools)).toEqual([undefined, []]);
      expect(sessions.map((s) => s.systemPrompt)).toEqual([
        expect.objectContaining({ type: "preset" }),
        expect.any(String),
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "runs an Analyst turn in the SDK's default mode whatever approval mode the conversation holds",
    async () => {
      const { port } = await start(true);
      const trace = await traceFile();
      const owner = await connect(port, {
        userId: "owner",
        modes: ["builder", "analyst"],
      });
      sendHello(owner.client, "c-auto");
      sendWire(owner.client, {
        type: "set_conversation_mode",
        conversationId: "c-auto",
        mode: "auto",
        assistant: "analyst",
      });
      await owner.collector.next(
        (e) => e.type === "conversation_mode" && e.assistant === "analyst",
      );
      expect(await runTurn(owner, "c-auto")).toBe("run_done");
      const modes = readClaudeTrace(trace)
        .filter((e) => e.kind === "session" || e.kind === "permission_mode")
        .map((e) => e.permissionMode);
      expect(modes).not.toContain("auto");
      expect(modes[0]).toBe("default");
      expect(owner.collector.events.map((e) => e.type)).not.toContain("notice");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "hands a running conversation to the user's other open stream when the one that asked closes",
    async () => {
      const { port, bridge } = await start(true);
      const firstTab = await connect(port, {
        userId: "ada",
        modes: ["analyst"],
        grant: "grant-tab-1",
      });
      expect(await runTurn(firstTab, "c-ada")).toBe("run_done");
      await connect(port, {
        userId: "ada",
        modes: ["analyst"],
        grant: "grant-tab-2",
      });
      await connect(port, {
        userId: "ada",
        tenantId: "other",
        modes: ["analyst"],
        grant: "grant-other",
      });
      await quiet();
      firstTab.client.close();
      await quiet();
      expect(bridge.services?.turnActors.get("c-ada")?.grant).toBe(
        "grant-tab-2",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "lets only the user who started a conversation switch it between Builder and Analyst",
    async () => {
      const { port, conversationStore } = await start(true);
      const first = await connect(port, {
        userId: "owner-1",
        modes: ["builder", "analyst"],
      });
      expect(await runTurn(first, "c-shared")).toBe("run_done");
      const second = await connect(port, {
        userId: "owner-2",
        modes: ["builder", "analyst"],
      });
      sendWire(second.client, {
        type: "set_conversation_mode",
        conversationId: "c-shared",
        assistant: "analyst",
      });
      await quiet();
      expect(conversationStore.get("c-shared")?.assistant).toBe("builder");
      sendWire(first.client, {
        type: "set_conversation_mode",
        conversationId: "c-shared",
        assistant: "analyst",
      });
      await quiet();
      expect(conversationStore.get("c-shared")?.assistant).toBe("analyst");
    },
    TEST_TIMEOUT_MS,
  );
});
