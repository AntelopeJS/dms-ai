import { existsSync } from "node:fs";
import { rawDataToText } from "../../src/server/raw-data.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { CODEX_PID_REGISTRY_FILE } from "../../src/constants/codex.js";
import { ASK_USER_TOOL_NAME } from "../../src/constants/mcp.js";
import { buildSkillCatalog } from "../../src/skills/build-catalog.js";
import { resolveSkillSources } from "../../src/skills/resolve-sources.js";
import type { ProviderName } from "../../src/state/types.js";
import {
  CODEX_FIXTURE,
  codexScript,
  codexTurns,
  PROVIDER_FIXTURES,
  readCodexTrace,
  readTrace,
  traceCodexInto,
  traceInto,
} from "../helpers/provider-fixtures.js";
import {
  createCollector,
  openIframe,
  sendHello,
  sendUserMessage,
  sendUserMessageWithAttachment,
  sendWire,
  startWsHarness,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

const CONVERSATION_A = "conv-recipe-a";
const CONVERSATION_B = "conv-recipe-b";
const WAIT_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 40_000;
const ANSWER = "Yes";
const SKILL_NAME = "cms-builder-safe";

// Claude is handed an allowlist naming the skill; Codex an extra root naming
// the directory it must scan. Same fact, two shapes.
const SKILL_EVIDENCE: Record<ProviderName, (skillDir: string) => string> = {
  claude: () => SKILL_NAME,
  codex: (skillDir) => skillDir,
};
const PROCESS_EXIT_MS = 500;

async function readPidRegistry(stateDir: string): Promise<number[]> {
  try {
    const raw = await readFile(join(stateDir, CODEX_PID_REGISTRY_FILE), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as number[]) : [];
  } catch {
    return [];
  }
}
// A one-page PDF, small enough to inline: Codex has no PDF input, so this is
// the attachment whose handling differs between providers.
const PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA5OSA5OV0+PgplbmRvYmoKdHJhaWxlcgo8PC9Sb290IDEgMCBSPj4K";

function isTerminal(msg: WireMessage): boolean {
  return msg.type === "run_done" || msg.type === "run_error";
}

// Scenarios 6, 7, 10, 11, 12 and 13: what a session exposes around its turns —
// skills, the AskUser round trip, isolation, teardown and attachments.
describe.each(PROVIDER_FIXTURES)("recipe — session on $name", (fixture) => {
  let harness: WsHarness | undefined;
  let client: WebSocket | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-recipe-"));
  });

  afterEach(async () => {
    client?.close();
    client = undefined;
    fixture.reset();
    await harness?.close();
    harness = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it(
    "10 — two conversations run in parallel without leaking into each other",
    async () => {
      fixture.use("simple");
      harness = await startWsHarness({ provider: fixture.name });
      const first = await openIframe(harness.port);
      const second = await openIframe(harness.port);
      client = first;
      const eventsA = createCollector(first, WAIT_TIMEOUT_MS);
      const eventsB = createCollector(second, WAIT_TIMEOUT_MS);
      sendHello(first, CONVERSATION_A);
      sendHello(second, CONVERSATION_B);
      sendUserMessage(first, CONVERSATION_A, "question A");
      sendUserMessage(second, CONVERSATION_B, "question B");
      await eventsA.next(isTerminal);
      await eventsB.next(isTerminal);
      second.close();

      // Every event a socket received belongs to its own conversation, and
      // each transcript holds only its own message.
      const foreignA = eventsA.events.filter(
        (e) => e.conversationId === CONVERSATION_B,
      );
      const foreignB = eventsB.events.filter(
        (e) => e.conversationId === CONVERSATION_A,
      );
      expect(foreignA).toEqual([]);
      expect(foreignB).toEqual([]);
      const storedA = harness.conversationStore.get(CONVERSATION_A);
      const storedB = harness.conversationStore.get(CONVERSATION_B);
      expect(storedA?.messages.map((m) => m.content)).toContain("question A");
      expect(storedB?.messages.map((m) => m.content)).toContain("question B");
      expect(storedA?.messages.map((m) => m.content)).not.toContain(
        "question B",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "6 — the module's skills are the ones handed to the agent",
    async () => {
      const skillDir = join(dir, "module-skills");
      await mkdir(join(skillDir, SKILL_NAME), { recursive: true });
      await writeFile(
        join(skillDir, SKILL_NAME, "SKILL.md"),
        `---\nname: ${SKILL_NAME}\ndescription: build through the Builder\n---\n`,
      );
      fixture.use("simple");
      const trace = join(dir, "trace.jsonl");
      traceInto(fixture.name, trace);
      harness = await startWsHarness({
        provider: fixture.name,
        skillDirs: [{ module: "cms-builder", dir: skillDir }],
      });
      client = await openIframe(harness.port);
      const collector = createCollector(client, WAIT_TIMEOUT_MS);
      sendHello(client, CONVERSATION_A);
      sendUserMessage(client, CONVERSATION_A, "use the builder");
      await collector.next(isTerminal);
      expect(readTrace(fixture.name, trace)).toContain(
        SKILL_EVIDENCE[fixture.name](skillDir),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "11 — a machine-local skill stays out of the catalog while the setting is off",
    async () => {
      const home = join(dir, "home");
      const localDir = join(home, ".claude", "skills");
      await mkdir(join(localDir, "local-only"), { recursive: true });
      await writeFile(
        join(localDir, "local-only", "SKILL.md"),
        "---\nname: local-only\ndescription: machine-local\n---\n",
      );

      const off = await buildSkillCatalog(resolveSkillSources([], false, home));
      expect(off.items.map((item) => item.name)).not.toContain("local-only");

      const on = await buildSkillCatalog(resolveSkillSources([], true, home));
      expect(on.items.map((item) => item.name)).toContain("local-only");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "13 — a PDF attachment reaches the agent and is recorded on the transcript",
    async () => {
      fixture.use("simple");
      harness = await startWsHarness({ provider: fixture.name });
      client = await openIframe(harness.port);
      const collector = createCollector(client, WAIT_TIMEOUT_MS);
      sendHello(client, CONVERSATION_A);
      sendUserMessageWithAttachment(client, CONVERSATION_A, "read this", {
        name: "spec.pdf",
        mimeType: "application/pdf",
        size: PDF_BASE64.length,
        data: PDF_BASE64,
      });
      const done = await collector.next(isTerminal);
      expect(done.type).toBe("run_done");
      const stored = harness.conversationStore.get(CONVERSATION_A);
      const attachments = stored?.messages.flatMap((m) => m.attachments ?? []);
      expect(attachments?.map((a) => a.name)).toContain("spec.pdf");
    },
    TEST_TIMEOUT_MS,
  );
});

// Scenarios only the Codex path can carry end to end: they read what the fake
// binary was actually asked to do.
describe("recipe — session on codex only", () => {
  let harness: WsHarness | undefined;
  let client: WebSocket | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-recipe-codex-"));
  });

  afterEach(async () => {
    client?.close();
    client = undefined;
    CODEX_FIXTURE.reset();
    await harness?.close();
    harness = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  async function runOneTurn(options: {
    script: string;
    skillDirs?: { module: string; dir: string }[];
    allowLocalSkills?: boolean;
    onMessage?: (msg: WireMessage, socket: WebSocket) => void;
  }): Promise<WireMessage[]> {
    CODEX_FIXTURE.use("simple");
    process.env.MOCK_CODEX_SCRIPT = options.script;
    traceCodexInto(join(dir, "trace.jsonl"));
    harness = await startWsHarness({
      provider: "codex",
      skillDirs: options.skillDirs,
      settings: { allowLocalSkills: options.allowLocalSkills ?? false },
    });
    client = await openIframe(harness.port);
    const collector = createCollector(client, WAIT_TIMEOUT_MS);
    if (options.onMessage !== undefined) {
      const socket = client;
      client.on("message", (data) => {
        const raw = rawDataToText(data);
        options.onMessage?.(JSON.parse(raw) as WireMessage, socket);
      });
    }
    sendHello(client, CONVERSATION_A);
    sendUserMessage(client, CONVERSATION_A, "go");
    await collector.next(isTerminal);
    return collector.events;
  }

  function tracedMethods(): string[] {
    return readCodexTrace(join(dir, "trace.jsonl"))
      .filter((entry) => entry.kind === "request")
      .map((entry) => entry.method ?? "");
  }

  it(
    "6 — module skills are handed to the agent as extra roots",
    async () => {
      const skillDir = join(dir, "skills");
      await runOneTurn({
        script: codexTurns("recette-1-simple-message.jsonl"),
        skillDirs: [{ module: "cms-builder", dir: skillDir }],
      });
      const roots = readCodexTrace(join(dir, "trace.jsonl")).find(
        (entry) => entry.method === "skills/extraRoots/set",
      );
      expect(roots?.params?.extraRoots).toContain(skillDir);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "7 — AskUser reaches the chatbox and the answer returns to the agent",
    async () => {
      const events = await runOneTurn({
        script: codexScript("mcp-ask-user.jsonl"),
        onMessage: (msg, socket) => {
          if (msg.type !== "ask_question") return;
          sendWire(socket, {
            type: "question_response",
            conversationId: msg.conversationId,
            requestId: msg.requestId,
            answers: [ANSWER],
          });
        },
      });
      const call = events.find(
        (e) =>
          e.type === "tool_call_start" &&
          String(e.toolName).endsWith(ASK_USER_TOOL_NAME),
      );
      expect(call).toBeDefined();
      const result = events.find((e) => e.type === "tool_call_end");
      expect(JSON.stringify(result?.result)).toContain(ANSWER);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "11 — a machine-local skill is switched off while the setting is off",
    async () => {
      await runOneTurn({
        script: codexTurns(
          "protocol-02-skills-scan.jsonl",
          "recette-1-simple-message.jsonl",
        ),
        allowLocalSkills: false,
      });
      const disabled = readCodexTrace(join(dir, "trace.jsonl"))
        .filter((entry) => entry.method === "skills/config/write")
        .map((entry) => String(entry.params?.path));
      expect(disabled.some((path) => path.includes("local-home-skill"))).toBe(
        true,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "11b — the same skill is left alone once the setting is on",
    async () => {
      await runOneTurn({
        script: codexTurns(
          "protocol-02-skills-scan.jsonl",
          "recette-1-simple-message.jsonl",
        ),
        allowLocalSkills: true,
      });
      const disabled = readCodexTrace(join(dir, "trace.jsonl"))
        .filter((entry) => entry.method === "skills/config/write")
        .map((entry) => String(entry.params?.path));
      expect(disabled.some((path) => path.includes("local-home-skill"))).toBe(
        false,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "12 — closing the sidecar leaves no app-server process behind",
    async () => {
      await runOneTurn({
        script: codexTurns("recette-1-simple-message.jsonl"),
      });
      const stateDir = join(harness?.tmpDir ?? "", ".state");
      const before = await readPidRegistry(stateDir);
      expect(before).toHaveLength(1);
      expect(existsSync(`/proc/${before[0]}`)).toBe(true);

      // The chatbox goes first, as it does when the host shuts down: an open
      // upgraded socket would hold the HTTP server's close.
      client?.close();
      client = undefined;
      await harness?.close();
      harness = undefined;
      await new Promise((done) => setTimeout(done, PROCESS_EXIT_MS));
      expect(await readPidRegistry(stateDir)).toEqual([]);
      expect(existsSync(`/proc/${before[0]}`)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "13 — a PDF is rendered as something the model can actually perceive",
    async () => {
      CODEX_FIXTURE.use("simple");
      traceCodexInto(join(dir, "trace.jsonl"));
      harness = await startWsHarness({ provider: "codex" });
      client = await openIframe(harness.port);
      const collector = createCollector(client, WAIT_TIMEOUT_MS);
      sendHello(client, CONVERSATION_A);
      sendUserMessageWithAttachment(client, CONVERSATION_A, "read this", {
        name: "spec.pdf",
        mimeType: "application/pdf",
        size: PDF_BASE64.length,
        data: PDF_BASE64,
      });
      await collector.next(isTerminal);
      const start = readCodexTrace(join(dir, "trace.jsonl")).find(
        (entry) => entry.method === "turn/start",
      );
      const input = JSON.stringify(start?.params?.input ?? []);
      // Either rasterized pages (poppler present) or the file referenced by
      // path — never silently dropped.
      expect(input).toContain("spec.pdf");
      expect(tracedMethods()).toContain("turn/start");
    },
    TEST_TIMEOUT_MS,
  );
});
