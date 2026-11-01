import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunnerContext } from "../../src/agent/runner.js";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { CLAUDE_FIXTURE, claudeScript } from "../helpers/provider-fixtures.js";
import { buildRunner, type RunnerHandle } from "../helpers/provider-runner.js";

const CONVERSATION_ID = "conv-model-fallback-1";
const REFUSED_MODEL = "claude-refused-9";
const DEFAULT_MODEL = "claude-mock";
const TEST_TIMEOUT_MS = 30_000;

interface Observed {
  events: RunnerEvent[];
  used: string[];
  fallbacks: Array<{ requested: string; used: string }>;
  trace: string;
}

describe("a configured model the API refuses", () => {
  let dir: string;
  let handle: RunnerHandle | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-model-fallback-"));
    CLAUDE_FIXTURE.use("plain");
    process.env.MOCK_CLAUDE_REFUSED_MODEL = REFUSED_MODEL;
    process.env.MOCK_CLAUDE_TRACE = join(dir, "trace.jsonl");
  });

  afterEach(async () => {
    await handle?.dispose();
    handle = undefined;
    CLAUDE_FIXTURE.reset();
    await rm(dir, { recursive: true, force: true });
  });

  async function runTurn(claudeModel: string): Promise<Observed> {
    handle = buildRunner("claude", {
      stateDir: join(dir, ".state"),
      settings: { ...DEFAULT_SETTINGS, claudeModel },
    });
    const observed: Observed = {
      events: [],
      used: [],
      fallbacks: [],
      trace: "",
    };
    const ctx: RunnerContext = {
      conversationId: CONVERSATION_ID,
      hostProjectRoot: dir,
      getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
      onModelUsed: (model) => observed.used.push(model),
      onModelFallback: (fallback) => observed.fallbacks.push(fallback),
    };
    for await (const event of handle.runner.start("list the files", ctx)) {
      observed.events.push(event);
    }
    observed.trace = await readFile(join(dir, "trace.jsonl"), "utf8");
    return observed;
  }

  it(
    "answers on the default model instead of failing the turn",
    async () => {
      const observed = await runTurn(REFUSED_MODEL);
      expect(observed.events.filter((e) => e.type === "error")).toEqual([]);
      expect(observed.events.at(-1)?.type).toBe("done");
      expect(observed.events.some((e) => e.type === "assistant_text")).toBe(
        true,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "names the model that answered, and the one it replaced",
    async () => {
      const observed = await runTurn(REFUSED_MODEL);
      expect(observed.fallbacks).toEqual([
        { requested: REFUSED_MODEL, used: DEFAULT_MODEL },
      ]);
      expect(observed.used).toEqual([DEFAULT_MODEL]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "hides the refusal text from the chat",
    async () => {
      const observed = await runTurn(REFUSED_MODEL);
      const shown = observed.events
        .flatMap((e) => (e.type === "assistant_text" ? [e.text] : []))
        .join("\n");
      expect(shown).not.toMatch(/issue with the selected model/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "switches the CLI to its default model exactly once",
    async () => {
      const observed = await runTurn(REFUSED_MODEL);
      const switches = observed.trace
        .split("\n")
        .filter((line) => line.includes('"kind":"model"'));
      expect(switches).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reports no fallback for a model the API accepts",
    async () => {
      const observed = await runTurn(DEFAULT_SETTINGS.claudeModel);
      expect(observed.fallbacks).toEqual([]);
      expect(observed.used).toEqual([DEFAULT_MODEL]);
      expect(observed.events.at(-1)?.type).toBe("done");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "leaves a failure that is not about the model alone",
    async () => {
      process.env.MOCK_CLAUDE_SCRIPT = claudeScript("api-error.json");
      const observed = await runTurn(REFUSED_MODEL.concat("-other"));
      expect(observed.fallbacks).toEqual([]);
      expect(observed.events.some((e) => e.type === "error")).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
