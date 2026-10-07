import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PendingRequest } from "../../src/agent/permission-bus.js";
import {
  conversationSettings,
  isFullAutoInForce,
} from "../../src/agent/effective-mode.js";
import { type AgentRunner, createAgentRunner } from "../../src/agent/runner.js";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { resolvePermissionMode } from "../../src/providers/claude/config.js";
import { createClaudeProvider } from "../../src/providers/claude/provider.js";
import {
  type AppSettings,
  CHAT_MODES,
  type ChatMode,
} from "../../src/state/settings-types.js";
import { createTestBus } from "../helpers/permission-bus.js";
import {
  readClaudeTrace,
  type TracedClaudeEntry,
} from "../helpers/provider-fixtures.js";

const SCRIPTS = resolve(import.meta.dirname, "../fixtures/mock-claude/scripts");
const TMP_PREFIX = "dms-ai-safe-mode-";
const CONVERSATION_ID = "conv-safe-mode";
const PROMPT_TIMEOUT_MS = 100;
const TURN_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = 30_000;
const BYPASS_MODE = "bypassPermissions";

interface RawCall {
  tool: string;
  script: string;
}

const RAW_CALLS: RawCall[] = [
  { tool: "Edit", script: "edit-file.json" },
  { tool: "Bash", script: "permission-required.json" },
  { tool: "Bash", script: "remove-directory.json" },
  { tool: "Bash", script: "read-only-command.json" },
];

const SAFE_CASES = CHAT_MODES.flatMap((mode) =>
  RAW_CALLS.map((call) => ({ mode, ...call })),
);

function settingsFor(
  mode: ChatMode,
  generationMode: AppSettings["generationMode"],
): AppSettings {
  return { ...DEFAULT_SETTINGS, mode, generationMode };
}

describe("resolvePermissionMode", () => {
  afterEach(() => setBuilderAvailable(false));

  it.each(CHAT_MODES)(
    "never hands the SDK bypassPermissions in safe mode (%s)",
    (mode) => {
      setBuilderAvailable(true);
      expect(resolvePermissionMode(settingsFor(mode, "safe"))).not.toBe(
        BYPASS_MODE,
      );
    },
  );

  it("never hands the SDK bypassPermissions, Full auto included", () => {
    for (const generationMode of ["safe", "vibe"] as const) {
      const settings = conversationSettings(DEFAULT_SETTINGS, {
        mode: "acceptEdits",
        generationMode,
        fullAuto: { duration: "turn" },
      });
      expect(resolvePermissionMode(settings)).not.toBe(BYPASS_MODE);
    }
  });
});

describe("Full auto per conversation", () => {
  afterEach(() => setBuilderAvailable(false));

  const FULL_AUTO = { duration: "30m" as const };

  it("runs a Code mode chat in default mode, the bus answering for the user", () => {
    setBuilderAvailable(true);
    const state = {
      mode: "plan" as const,
      generationMode: "vibe" as const,
      fullAuto: FULL_AUTO,
    };
    expect(conversationSettings(DEFAULT_SETTINGS, state).mode).toBe("normal");
    expect(isFullAutoInForce(state)).toBe(true);
  });

  it("caps Full auto at acceptEdits in safe mode, prompts still reaching the user", () => {
    setBuilderAvailable(true);
    const state = {
      mode: "normal" as const,
      generationMode: "safe" as const,
      fullAuto: FULL_AUTO,
    };
    expect(conversationSettings(DEFAULT_SETTINGS, state).mode).toBe(
      "acceptEdits",
    );
    expect(isFullAutoInForce(state)).toBe(false);
  });

  it("follows Code mode when safe mode degrades for want of the Builder", () => {
    const state = {
      mode: "normal" as const,
      generationMode: "safe" as const,
      fullAuto: FULL_AUTO,
    };
    expect(isFullAutoInForce(state)).toBe(true);
  });

  it("keeps the chat's own mode when Full auto is off", () => {
    const state = {
      mode: "plan" as const,
      generationMode: "vibe" as const,
      fullAuto: null,
    };
    expect(conversationSettings(DEFAULT_SETTINGS, state).mode).toBe("plan");
    expect(isFullAutoInForce(state)).toBe(false);
  });
});

describe("safe mode on the Claude provider, whatever the permission mode", () => {
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

  function openRunner(settings: AppSettings, script: string): AgentRunner {
    process.env.MOCK_CLAUDE_SCRIPT = join(SCRIPTS, script);
    const provider = createClaudeProvider({ timeoutMs: TURN_TIMEOUT_MS });
    runner = createAgentRunner(provider, { settings });
    return runner;
  }

  async function runTurn(active: AgentRunner): Promise<RunnerEvent[]> {
    const { bus: permissionBus } = createTestBus({
      timeoutMs: PROMPT_TIMEOUT_MS,
      extra: { onPromptChat: (event) => prompts.push(event) },
    });
    const events: RunnerEvent[] = [];
    for await (const event of active.start("go", {
      conversationId: CONVERSATION_ID,
      hostProjectRoot: dir,
      getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
      permissionBus,
    })) {
      events.push(event);
    }
    return events;
  }

  function traced(kind: string): TracedClaudeEntry[] {
    return readClaudeTrace(traceFile).filter((entry) => entry.kind === kind);
  }

  it.each(SAFE_CASES)(
    "refuses $tool from $script in $mode mode through the safe-mode hook",
    async ({ mode, tool, script }) => {
      await runTurn(openRunner(settingsFor(mode, "safe"), script));
      expect(traced("tool")).toEqual([
        { kind: "tool", name: tool, decidedBy: "hook", isAllowed: false },
      ]);
      expect(prompts).toEqual([]);
      expect(traced("session")[0]?.permissionMode).not.toBe(BYPASS_MODE);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "shows why canUseTool cannot carry safe mode: vibe + acceptEdits runs the edit unasked",
    async () => {
      await runTurn(
        openRunner(settingsFor("acceptEdits", "vibe"), "edit-file.json"),
      );
      expect(traced("tool")).toEqual([
        { kind: "tool", name: "Edit", decidedBy: "mode", isAllowed: true },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "shows why normal mode did not carry it either: a read-only command runs unasked",
    async () => {
      await runTurn(
        openRunner(settingsFor("normal", "vibe"), "read-only-command.json"),
      );
      expect(traced("tool")).toEqual([
        { kind: "tool", name: "Bash", decidedBy: "readOnly", isAllowed: true },
      ]);
      expect(prompts).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "still refuses after a live flip from vibe + acceptEdits to safe + plan",
    async () => {
      const active = openRunner(
        settingsFor("acceptEdits", "vibe"),
        "edit-file.json",
      );
      await runTurn(active);
      active.applySettings(settingsFor("plan", "safe"));
      await runTurn(active);
      expect(traced("permission_mode").at(-1)?.permissionMode).toBe("plan");
      expect(traced("tool").at(-1)).toEqual({
        kind: "tool",
        name: "Edit",
        decidedBy: "hook",
        isAllowed: false,
      });
    },
    TEST_TIMEOUT_MS,
  );
});
