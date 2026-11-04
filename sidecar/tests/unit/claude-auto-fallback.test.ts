import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AgentRunner, createAgentRunner } from "../../src/agent/runner.js";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { createClaudeProvider } from "../../src/providers/claude/provider.js";
import type { AppSettings, ChatMode } from "../../src/state/settings-types.js";
import { writeClaudeScript } from "../helpers/claude-scripts.js";
import { createTestBus } from "../helpers/permission-bus.js";
import {
  CLAUDE_FIXTURE,
  readClaudeTrace,
} from "../helpers/provider-fixtures.js";

const CONVERSATION_ID = "conv-auto-fallback";
const WITHOUT_AUTO = "claude-haiku-4-5-20251001";
const WITH_AUTO = "claude-opus-5-5";
const API_REFUSED = "claude-nonexistent-9";
const TURN_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = 30_000;

function settingsOn(claudeModel: string, mode: ChatMode): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    generationMode: "vibe",
    claudeModel,
    defaultModes: { ...DEFAULT_SETTINGS.defaultModes, claude: mode },
  };
}

describe("Auto review the CLI will not run", () => {
  let dir: string;
  let traceFile: string;
  let runner: AgentRunner | undefined;
  let refusals: string[];

  beforeEach(async () => {
    refusals = [];
    dir = await mkdtemp(join(tmpdir(), "dms-ai-auto-fallback-"));
    traceFile = join(dir, "trace.jsonl");
    CLAUDE_FIXTURE.use("plain");
    process.env.MOCK_CLAUDE_TRACE = traceFile;
    process.env.MOCK_CLAUDE_AUTO_UNSUPPORTED_MODEL = WITHOUT_AUTO;
    process.env.MOCK_CLAUDE_SCRIPT = await writeClaudeScript(dir, "edit", [
      { id: "edit", name: "Write", input: { file_path: "src/note.ts" } },
    ]);
  });

  afterEach(async () => {
    await runner?.dispose();
    runner = undefined;
    CLAUDE_FIXTURE.reset();
    await rm(dir, { recursive: true, force: true });
  });

  function open(settings: AppSettings): AgentRunner {
    runner = createAgentRunner(
      createClaudeProvider({ timeoutMs: TURN_TIMEOUT_MS }),
      { settings },
    );
    return runner;
  }

  async function runTurn(active: AgentRunner): Promise<RunnerEvent[]> {
    const events: RunnerEvent[] = [];
    const { bus } = createTestBus({
      extra: {
        onPromptChat: (request) =>
          bus.resolvePermission({
            requestId: request.requestId,
            decision: PERMISSION_DECISIONS.ALLOW_ONCE,
          }),
      },
    });
    for await (const event of active.start("go", {
      conversationId: CONVERSATION_ID,
      hostProjectRoot: dir,
      getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
      permissionBus: bus,
      onAutoRefused: (model) => refusals.push(model),
    })) {
      events.push(event);
    }
    return events;
  }

  function lastDecider(): string | undefined {
    return readClaudeTrace(traceFile)
      .filter((entry) => entry.kind === "tool")
      .at(-1)?.decidedBy;
  }

  function endedCleanly(events: RunnerEvent[]): void {
    expect(events.filter((e) => e.type === "error")).toEqual([]);
    expect(events.at(-1)?.type).toBe("done");
  }

  it(
    "reports a session that started without Auto review, and still runs the turn",
    async () => {
      const events = await runTurn(open(settingsOn(WITHOUT_AUTO, "auto")));
      expect(refusals).toEqual([WITHOUT_AUTO]);
      endedCleanly(events);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reports a switch onto a model without Auto review on the next turn",
    async () => {
      const active = open(settingsOn(WITH_AUTO, "auto"));
      await runTurn(active);
      expect(refusals).toEqual([]);
      active.applySettings(settingsOn(WITHOUT_AUTO, "auto"));
      const events = await runTurn(active);
      expect(refusals).toEqual([WITHOUT_AUTO]);
      endedCleanly(events);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "survives the CLI refusing Auto review mid-session, and reads the refusal back",
    async () => {
      const active = open(settingsOn(WITHOUT_AUTO, "normal"));
      await runTurn(active);
      active.applySettings(settingsOn(WITHOUT_AUTO, "auto"));
      const events = await runTurn(active);
      expect(refusals).toEqual([WITHOUT_AUTO]);
      endedCleanly(events);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "resumes Auto review when a session moves onto a model with it",
    async () => {
      const active = open(settingsOn(WITHOUT_AUTO, "normal"));
      await runTurn(active);
      active.applySettings(settingsOn(WITH_AUTO, "auto"));
      await runTurn(active);
      expect(refusals).toEqual([]);
      expect(lastDecider()).toBe("classifier");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps Auto review on the default model when the API refuses the configured one",
    async () => {
      process.env.MOCK_CLAUDE_REFUSED_MODEL = API_REFUSED;
      const events = await runTurn(open(settingsOn(API_REFUSED, "auto")));
      expect(refusals).toEqual([]);
      expect(lastDecider()).toBe("classifier");
      endedCleanly(events);
    },
    TEST_TIMEOUT_MS,
  );
});
