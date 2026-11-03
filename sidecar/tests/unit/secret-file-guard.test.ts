import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PendingRequest } from "../../src/agent/permission-bus.js";
import { type AgentRunner, createAgentRunner } from "../../src/agent/runner.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { createClaudeProvider } from "../../src/providers/claude/provider.js";
import {
  type AppSettings,
  type TurnSettings,
  CHAT_MODES,
  type ChatMode,
} from "../../src/state/settings-types.js";
import { createTestBus } from "../helpers/permission-bus.js";
import {
  readClaudeTrace,
  type TracedClaudeEntry,
} from "../helpers/provider-fixtures.js";

const SCRIPTS = resolve(import.meta.dirname, "../fixtures/mock-claude/scripts");
const TMP_PREFIX = "dms-ai-secret-guard-";
const CONVERSATION_ID = "conv-secret-guard";
const PROMPT_TIMEOUT_MS = 100;
const TURN_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = 30_000;
const GENERATION_MODES = ["safe", "vibe"] as const;

const CASES = CHAT_MODES.flatMap((mode) =>
  GENERATION_MODES.map((generationMode) => ({ mode, generationMode })),
);

function settingsFor(
  mode: ChatMode,
  generationMode: AppSettings["generationMode"],
): TurnSettings {
  return { ...DEFAULT_SETTINGS, mode, generationMode };
}

describe("the agent's file tools on a project secret file", () => {
  let dir: string;
  let traceFile: string;
  let prompts: PendingRequest[];
  let runner: AgentRunner | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    traceFile = join(dir, "trace.jsonl");
    prompts = [];
    setBuilderAvailable(true);
    process.env.MOCK_CLAUDE = "1";
    process.env.MOCK_CLAUDE_TRACE = traceFile;
  });

  afterEach(async () => {
    await runner?.dispose();
    runner = undefined;
    setBuilderAvailable(false);
    delete process.env.MOCK_CLAUDE;
    delete process.env.MOCK_CLAUDE_SCRIPT;
    delete process.env.MOCK_CLAUDE_TRACE;
    await rm(dir, { recursive: true, force: true });
  });

  async function readTool(
    settings: TurnSettings,
    script: string,
  ): Promise<TracedClaudeEntry[]> {
    process.env.MOCK_CLAUDE_SCRIPT = join(SCRIPTS, script);
    const provider = createClaudeProvider({ timeoutMs: TURN_TIMEOUT_MS });
    runner = createAgentRunner(provider, { settings });
    const { bus: permissionBus } = createTestBus({
      timeoutMs: PROMPT_TIMEOUT_MS,
      extra: { onPromptChat: (event) => prompts.push(event) },
    });
    const turn = runner
      .start("go", {
        conversationId: CONVERSATION_ID,
        hostProjectRoot: dir,
        getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
        permissionBus,
      })
      [Symbol.asyncIterator]();
    let step = await turn.next();
    while (step.done !== true) step = await turn.next();
    return readClaudeTrace(traceFile).filter((entry) => entry.kind === "tool");
  }

  it.each(CASES)(
    "refuses a Read of .env through the hook, unasked, in $mode mode with $generationMode generation",
    async ({ mode, generationMode }) => {
      const tools = await readTool(
        settingsFor(mode, generationMode),
        "read-env-file.json",
      );
      expect(tools).toEqual([
        { kind: "tool", name: "Read", decidedBy: "hook", isAllowed: false },
      ]);
      expect(prompts).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it.each(CASES)(
    "lets a Read of the committed .env.example through in $mode mode with $generationMode generation",
    async ({ mode, generationMode }) => {
      const tools = await readTool(
        settingsFor(mode, generationMode),
        "read-env-example.json",
      );
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({ name: "Read", isAllowed: true });
      expect(tools[0]?.decidedBy).not.toBe("hook");
    },
    TEST_TIMEOUT_MS,
  );
});
