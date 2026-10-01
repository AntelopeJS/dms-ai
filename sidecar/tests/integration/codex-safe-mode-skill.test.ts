import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import type { ProviderSession } from "../../src/agent/provider.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import {
  SAFE_MODE_SKILL_MISSING_MESSAGE,
  SAFE_MODE_SKILL_MISSING_WARNING,
} from "../../src/constants/codex.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import {
  createMcpHttpRegistry,
  type McpHttpRegistry,
} from "../../src/mcp/http-binding.js";
import type { AiMcpServerDeps } from "../../src/mcp/types.js";
import { createCodexProvider } from "../../src/providers/codex/provider.js";
import type { AppSettings } from "../../src/state/settings-types.js";
import {
  CODEX_FIXTURE,
  codexScript,
  codexTurns,
  readCodexTrace,
  traceCodexInto,
} from "../helpers/provider-fixtures.js";

const TEST_TIMEOUT_MS = 30_000;
const CONVERSATION = "conv-safe-skill";
const SIMPLE_DUMP = "recette-1-simple-message.jsonl";
const EMPTY_SKILL_INDEX = "skills-index-empty.jsonl";
const SCRIPT_SEPARATOR = ",";
const TURN_START = "turn/start";

const SAFE_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  generationMode: "safe",
};

const VIBE_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  generationMode: "vibe",
};

function withoutSafeModeSkill(turns: number): string {
  const dumps = codexTurns(...Array<string>(turns).fill(SIMPLE_DUMP));
  return [dumps, codexScript(EMPTY_SKILL_INDEX)].join(SCRIPT_SEPARATOR);
}

async function drainTurn(
  session: ProviderSession,
  settings: AppSettings,
): Promise<void> {
  for await (const _event of session.runTurn(
    { text: "hello", attachments: [] },
    settings,
  )) {
    // Drained: the turn is only over once its events are consumed.
  }
}

function missingSkillWarnings(spy: MockInstance): number {
  return spy.mock.calls.filter((args) =>
    String(args.join(" ")).includes(SAFE_MODE_SKILL_MISSING_WARNING),
  ).length;
}

describe("codex safe-mode skill guard", () => {
  let dir: string;
  let registry: McpHttpRegistry | undefined;
  let session: ProviderSession | undefined;
  let warn: MockInstance;

  async function openSession(settings: AppSettings): Promise<ProviderSession> {
    registry = createMcpHttpRegistry();
    const provider = createCodexProvider({
      settings,
      stateDir: join(dir, ".state"),
      mcpHttpRegistry: registry,
      createMcpDeps: () => ({}) as unknown as AiMcpServerDeps,
      getMcpUrl: () => "http://127.0.0.1:1/mcp",
      getApiKey: () => "sk-mock",
    });
    session = await provider.createSession({
      conversationId: CONVERSATION,
      hostProjectRoot: dir,
      getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
      settings,
      onDisposed: () => {},
    });
    return session;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-safe-skill-"));
    setBuilderAvailable(true);
    CODEX_FIXTURE.use("simple");
    warn = vi.spyOn(console, "warn");
  });

  afterEach(async () => {
    await session?.dispose();
    session = undefined;
    await registry?.dispose();
    registry = undefined;
    CODEX_FIXTURE.reset();
    setBuilderAvailable(false);
    warn.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });

  it(
    "warns once per session when the skill is missing, and vibe turns still run",
    async () => {
      process.env.MOCK_CODEX_SCRIPT = withoutSafeModeSkill(2);
      const opened = await openSession(VIBE_SETTINGS);
      await drainTurn(opened, VIBE_SETTINGS);
      await drainTurn(opened, VIBE_SETTINGS);
      expect(missingSkillWarnings(warn)).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "fails a safe-mode turn before it reaches codex when the skill is missing",
    async () => {
      const trace = join(dir, "trace.jsonl");
      traceCodexInto(trace);
      process.env.MOCK_CODEX_SCRIPT = withoutSafeModeSkill(1);
      const opened = await openSession(SAFE_SETTINGS);
      await expect(drainTurn(opened, SAFE_SETTINGS)).rejects.toThrow(
        SAFE_MODE_SKILL_MISSING_MESSAGE,
      );
      const turnStarts = readCodexTrace(trace).filter(
        (entry) => entry.method === TURN_START,
      );
      expect(turnStarts).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "neither warns nor fails when the skill made the index",
    async () => {
      const opened = await openSession(SAFE_SETTINGS);
      await drainTurn(opened, SAFE_SETTINGS);
      expect(missingSkillWarnings(warn)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});
