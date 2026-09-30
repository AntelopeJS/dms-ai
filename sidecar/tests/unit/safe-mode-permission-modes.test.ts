import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPermissionBus,
  type PendingRequest,
} from "../../src/agent/permission-bus.js";
import { type AgentRunner, createAgentRunner } from "../../src/agent/runner.js";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { resolvePermissionMode } from "../../src/providers/claude/config.js";
import { createClaudeProvider } from "../../src/providers/claude/provider.js";
import { createIframeSocketRegistry } from "../../src/server/iframe-socket-registry.js";
import { applySettings } from "../../src/server/routing.js";
import type { SettingsStore } from "../../src/state/settings-store.js";
import {
  type AppSettings,
  CHATBOX_MODES,
  type ChatboxMode,
} from "../../src/state/settings-types.js";
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

const SAFE_CASES = CHATBOX_MODES.flatMap((mode) =>
  RAW_CALLS.map((call) => ({ mode, ...call })),
);

function settingsFor(
  mode: ChatboxMode,
  generationMode: AppSettings["generationMode"],
): AppSettings {
  return { ...DEFAULT_SETTINGS, mode, generationMode };
}

describe("resolvePermissionMode", () => {
  afterEach(() => setBuilderAvailable(false));

  it.each(CHATBOX_MODES)(
    "never hands the SDK bypassPermissions in safe mode (%s)",
    (mode) => {
      setBuilderAvailable(true);
      expect(resolvePermissionMode(settingsFor(mode, "safe"))).not.toBe(
        BYPASS_MODE,
      );
    },
  );

  it("maps auto to acceptEdits in safe mode and to bypassPermissions in vibe mode", () => {
    setBuilderAvailable(true);
    expect(resolvePermissionMode(settingsFor("auto", "safe"))).toBe(
      "acceptEdits",
    );
    expect(resolvePermissionMode(settingsFor("auto", "vibe"))).toBe(
      BYPASS_MODE,
    );
  });

  it("follows vibe mode when safe mode degrades for want of the Builder", () => {
    expect(resolvePermissionMode(settingsFor("auto", "safe"))).toBe(
      BYPASS_MODE,
    );
  });
});

describe("auto-approval by the permission bus", () => {
  afterEach(() => setBuilderAvailable(false));

  function storeOf(settings: AppSettings): SettingsStore {
    let current = settings;
    return {
      get: () => current,
      set: (next) => {
        current = next;
      },
      load: () => Promise.resolve(),
      flush: () => Promise.resolve(),
    };
  }

  async function promptsUnder(settings: AppSettings): Promise<number> {
    const prompts: PendingRequest[] = [];
    const permissionBus = createPermissionBus({
      onPromptIframe: (event) => prompts.push(event),
      timeoutMs: PROMPT_TIMEOUT_MS,
    });
    const runner = { applySettings: () => undefined } as unknown as AgentRunner;
    applySettings(
      {
        settingsStore: storeOf(settings),
        permissionBus,
        runner,
        iframeSocketRegistry: createIframeSocketRegistry(),
      },
      settings,
    );
    await permissionBus.requestPermission({
      conversationId: CONVERSATION_ID,
      toolName: "WebFetch",
      args: {},
    });
    return prompts.length;
  }

  it("approves every prompt in vibe + auto", async () => {
    setBuilderAvailable(true);
    expect(await promptsUnder(settingsFor("auto", "vibe"))).toBe(0);
  });

  it("still asks in safe + auto, as in acceptEdits", async () => {
    setBuilderAvailable(true);
    expect(await promptsUnder(settingsFor("auto", "safe"))).toBe(1);
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
    const permissionBus = createPermissionBus({
      onPromptIframe: (event) => prompts.push(event),
      timeoutMs: PROMPT_TIMEOUT_MS,
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
    "shows why canUseTool cannot carry safe mode: vibe + auto runs the edit unasked",
    async () => {
      await runTurn(openRunner(settingsFor("auto", "vibe"), "edit-file.json"));
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
    "still refuses after a live flip from vibe + auto to safe + plan",
    async () => {
      const active = openRunner(settingsFor("auto", "vibe"), "edit-file.json");
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
