import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderSession } from "../../src/agent/provider.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
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
  codexTurns,
  readCodexTrace,
  traceCodexInto,
} from "../helpers/provider-fixtures.js";

const TEST_TIMEOUT_MS = 30_000;
const SETTLE_MS = 400;
const CONVERSATION = "conv-denial";
const DENIED_DUMP = "recette-3-command-denied.jsonl";
const TURN_START = "turn/start";
// CODEX_DENIAL_REMINDER_THRESHOLD is 2, so the third turn is the first to carry
// the reminder.
const TURNS = 3;

const SAFE_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  generationMode: "safe",
};

interface TurnText {
  type: string;
  text?: string;
}

function turnTexts(trace: ReturnType<typeof readCodexTrace>): string[] {
  return trace
    .filter((entry) => entry.method === TURN_START)
    .map((entry) => {
      const input = (entry.params?.input ?? []) as TurnText[];
      return input
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n");
    });
}

describe("codex denial reminder", () => {
  let dir: string;
  let registry: McpHttpRegistry | undefined;
  let session: ProviderSession | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-denial-"));
    // Safe mode degrades to vibe without the Builder, and then nothing is
    // refused at all.
    setBuilderAvailable(true);
    CODEX_FIXTURE.use("permission");
  });

  afterEach(async () => {
    session?.dispose();
    session = undefined;
    await registry?.dispose();
    registry = undefined;
    CODEX_FIXTURE.reset();
    setBuilderAvailable(false);
    await new Promise((done) => setTimeout(done, SETTLE_MS));
    await rm(dir, { recursive: true, force: true });
  });

  it(
    "tells the agent it is looping only once it has been refused twice",
    async () => {
      const trace = join(dir, "trace.jsonl");
      traceCodexInto(trace);
      process.env.MOCK_CODEX_SCRIPT = codexTurns(
        ...Array<string>(TURNS).fill(DENIED_DUMP),
      );
      registry = createMcpHttpRegistry();
      const provider = createCodexProvider({
        settings: SAFE_SETTINGS,
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
        settings: SAFE_SETTINGS,
        onDisposed: () => {},
      });

      for (let turn = 0; turn < TURNS; turn++) {
        for await (const _event of session.runTurn(
          { text: `write the file, attempt ${turn}`, attachments: [] },
          SAFE_SETTINGS,
        )) {
          // Drained: the turn is only over once its events are consumed.
        }
      }

      const [first, second, third] = turnTexts(readCodexTrace(trace));
      expect(first).not.toContain("times in a row");
      expect(second).not.toContain("times in a row");
      expect(third).toContain("refused 2 times in a row");
    },
    TEST_TIMEOUT_MS,
  );
});
