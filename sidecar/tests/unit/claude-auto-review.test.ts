import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  PendingRequest,
  PermissionPolicy,
} from "../../src/agent/permission-bus.js";
import type { ToolDecision } from "../../src/agent/provider.js";
import { type AgentRunner, createAgentRunner } from "../../src/agent/runner.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { MCP_TOOL_NAME_PREFIX } from "../../src/constants/mcp.js";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import type { PermissionDecisionValue } from "../../src/protocol/messages.js";
import { createClaudeProvider } from "../../src/providers/claude/provider.js";
import type { AppSettings } from "../../src/state/settings-types.js";
import {
  type ScriptedCall,
  writeClaudeScript,
} from "../helpers/claude-scripts.js";
import { createTestBus } from "../helpers/permission-bus.js";
import {
  readClaudeTrace,
  type TracedClaudeEntry,
} from "../helpers/provider-fixtures.js";

const CONVERSATION_ID = "conv-auto-review";
const PROMPT_TIMEOUT_MS = 2_000;
const TURN_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = 30_000;
const MCP = MCP_TOOL_NAME_PREFIX;
const DEPENDENCY_CHANGE = { command: "pnpm add jsvat" };
const PLAIN_COMMAND = { command: "node -e \"console.log('hi')\"" };
const WEB_PAGE = { url: "https://example.com/docs", prompt: "summarize" };
const EDIT_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];

const ASKED = { decidedBy: "canUseTool", isAllowed: true };
const REFUSED_WHEN_ASKED = { decidedBy: "canUseTool", isAllowed: false };
const REVIEWED = { decidedBy: "classifier", isAllowed: true };
const REFUSED_IN_REVIEW = { decidedBy: "classifier", isAllowed: false };
const UNREVIEWED = { decidedBy: "mode", isAllowed: true };

interface TurnOptions {
  settings?: Partial<AppSettings>;
  policy?: Partial<PermissionPolicy>;
  answer?: PermissionDecisionValue;
}

const DEPENDENCY_ASK_OFF: TurnOptions = {
  settings: { alwaysAskDependencies: false },
  policy: { alwaysAskDependencies: false },
};

interface Turn {
  prompts: PendingRequest[];
  decisions: ToolDecision[];
  announced: string[];
  tools: TracedClaudeEntry[];
  sessionMode: string | undefined;
}

let dir: string;
let traceFile: string;
let runner: AgentRunner | undefined;

async function runTurn(
  calls: ScriptedCall[],
  options: TurnOptions = {},
): Promise<Turn> {
  process.env.MOCK_CLAUDE_SCRIPT = await writeClaudeScript(dir, "turn", calls);
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    generationMode: "vibe",
    ...options.settings,
  };
  runner = createAgentRunner(
    createClaudeProvider({ timeoutMs: TURN_TIMEOUT_MS }),
    { settings },
  );
  const prompts: PendingRequest[] = [];
  const decisions: ToolDecision[] = [];
  const announced: string[] = [];
  const { bus } = createTestBus({
    timeoutMs: PROMPT_TIMEOUT_MS,
    policy: { hostProjectRoot: dir, ...options.policy },
    extra: {
      onPromptChat: (request) => {
        prompts.push(request);
        bus.resolvePermission({
          requestId: request.requestId,
          decision: options.answer ?? PERMISSION_DECISIONS.ALLOW_ONCE,
        });
      },
    },
  });
  for await (const _event of runner.start("go", {
    conversationId: CONVERSATION_ID,
    hostProjectRoot: dir,
    getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
    permissionBus: bus,
    onToolDecision: (decision) => decisions.push(decision),
    onToolAnnounced: (callId) => announced.push(callId),
  })) {
  }
  const trace = readClaudeTrace(traceFile);
  return {
    prompts,
    decisions,
    announced,
    tools: trace.filter((entry) => entry.kind === "tool"),
    sessionMode: trace.find((entry) => entry.kind === "session")
      ?.permissionMode,
  };
}

function registerModePromptTests() {
  it(
    "asks before a dependency change, and a refusal stops it",
    async () => {
      const turn = await runTurn(
        [{ id: "dep", name: "Bash", input: DEPENDENCY_CHANGE }],
        { answer: PERMISSION_DECISIONS.DENY },
      );
      expect(turn.sessionMode).toBe("auto");
      expect(turn.prompts.map((p) => p.alwaysAsk)).toEqual([true]);
      expect(turn.tools).toMatchObject([REFUSED_WHEN_ASKED]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "asks before a dependency change as before any command when the setting is off",
    async () => {
      const turn = await runTurn(
        [{ id: "dep", name: "Bash", input: DEPENDENCY_CHANGE }],
        DEPENDENCY_ASK_OFF,
      );
      expect(turn.prompts.map((p) => p.alwaysAsk)).toEqual([false]);
      expect(turn.tools).toMatchObject([ASKED]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "asks before every command in Ask first, read-only ones included",
    async () => {
      const turn = await runTurn(
        [
          { id: "read", name: "Bash", input: { command: "cat package.json" } },
          { id: "list", name: "Bash", input: { command: "ls -la" } },
        ],
        { settings: { defaultModes: { claude: "normal", codex: "normal" } } },
      );
      expect(turn.sessionMode).toBe("default");
      expect(turn.prompts.map((p) => p.callId)).toEqual(["read", "list"]);
      expect(turn.tools).toMatchObject([ASKED, ASKED]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "asks before every command and the always-ask files in Accept edits, and applies other edits",
    async () => {
      const turn = await runTurn(
        [
          { id: "touch", name: "Bash", input: { command: "touch b.txt" } },
          { id: "edit", name: "Write", input: { file_path: "src/a.ts" } },
          {
            id: "manifest",
            name: "Write",
            input: { file_path: "package.json" },
          },
          {
            id: "hook",
            name: "Write",
            input: { file_path: ".git/hooks/pre-commit" },
          },
        ],
        {
          settings: {
            defaultModes: { claude: "acceptEdits", codex: "acceptEdits" },
          },
        },
      );
      expect(turn.sessionMode).toBe("acceptEdits");
      expect(turn.prompts.map((p) => [p.callId, p.alwaysAsk])).toEqual([
        ["touch", false],
        ["manifest", true],
        ["hook", true],
      ]);
      expect(turn.tools).toMatchObject([ASKED, UNREVIEWED, ASKED, ASKED]);
    },
    TEST_TIMEOUT_MS,
  );
}

function registerAlwaysAskCommandTests() {
  it(
    "asks before an edit of a git hook file under Auto review",
    async () => {
      const turn = await runTurn([
        {
          id: "hook",
          name: "Write",
          input: { file_path: ".husky/pre-commit" },
        },
        { id: "manager", name: "Write", input: { file_path: "lefthook.yml" } },
      ]);
      expect(turn.prompts.map((p) => [p.callId, p.alwaysAsk])).toEqual([
        ["hook", true],
        ["manager", true],
      ]);
      expect(turn.tools).toMatchObject([ASKED, ASKED]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "sends every command to the person, whatever it wraps or reads",
    async () => {
      const turn = await runTurn([
        { id: "plain", name: "Bash", input: PLAIN_COMMAND },
        {
          id: "wrapped",
          name: "Bash",
          input: { command: 'sh -c "npm install is-odd"' },
        },
        { id: "read", name: "Bash", input: { command: "cat package.json" } },
      ]);
      expect(turn.prompts.map((p) => p.callId)).toEqual([
        "plain",
        "wrapped",
        "read",
      ]);
      expect(turn.tools).toMatchObject([ASKED, ASKED, ASKED]);
      expect(turn.decisions).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "sends a tool it does not leave to Auto review to the person, whatever its name",
    async () => {
      const install = { command: "npm install is-odd", timeout_ms: 1 };
      const turn = await runTurn([
        { id: "monitor", name: "Monitor", input: install },
        { id: "cron", name: "CronCreate", input: { prompt: "npm i" } },
        { id: "new", name: "ToolTheCliAddsNext", input: install },
        { id: "mcp", name: "mcp__acme__Frobnicate", input: {} },
        { id: "remote", name: "Agent", input: { isolation: "remote" } },
      ]);
      expect(turn.prompts.map((p) => p.callId)).toEqual([
        "monitor",
        "cron",
        "new",
        "mcp",
        "remote",
      ]);
      expect(turn.tools).toMatchObject([ASKED, ASKED, ASKED, ASKED, ASKED]);
      expect(turn.decisions).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "asks before an edit of each dependency manifest, lockfile and setting, as always-ask",
    async () => {
      const files = [
        "package.json",
        "pnpm-lock.yaml",
        "package-lock.json",
        "yarn.lock",
        "bun.lockb",
        "bun.lock",
        "npm-shrinkwrap.json",
        "pnpm-workspace.yaml",
        ".npmrc",
        ".pnpmfile.cjs",
        ".yarnrc.yml",
        ".yarnrc",
        "bunfig.toml",
      ];
      const turn = await runTurn(
        files.map((file, index) => {
          const name = EDIT_TOOLS[index % EDIT_TOOLS.length] ?? "Write";
          const path = join(dir, "packages", "app", file);
          const pathKey =
            name === "NotebookEdit" ? "notebook_path" : "file_path";
          return { id: file, name, input: { [pathKey]: path } };
        }),
      );
      expect(turn.prompts.map((p) => [p.callId, p.alwaysAsk])).toEqual(
        files.map((file) => [file, true]),
      );
      expect(turn.tools).toMatchObject(files.map(() => ASKED));
    },
    TEST_TIMEOUT_MS,
  );
}

function registerDependencyFileTests() {
  it(
    "asks before a dependency file edit however its path is spelled, and leaves other edits to Auto review",
    async () => {
      const turn = await runTurn([
        {
          id: "relative",
          name: "Write",
          input: { file_path: "src/../package.json" },
        },
        {
          id: "dotted",
          name: "Edit",
          input: { file_path: join(dir, "src", "..", "pnpm-lock.yaml") },
        },
        {
          id: "trailing",
          name: "Write",
          input: { file_path: `${join(dir, "package.json")}/.` },
        },
        {
          id: "cased",
          name: "Write",
          input: { file_path: join(dir, "Package.JSON") },
        },
        {
          id: "outside",
          name: "Write",
          input: { file_path: "/elsewhere/.npmrc" },
        },
        {
          id: "lookalike",
          name: "Write",
          input: { file_path: join(dir, "src", "package.json.ts") },
        },
      ]);
      expect(turn.prompts.map((p) => [p.callId, p.alwaysAsk])).toEqual([
        ["relative", true],
        ["dotted", true],
        ["trailing", true],
        ["cased", true],
        ["outside", true],
      ]);
      expect(turn.tools).toMatchObject([
        ASKED,
        ASKED,
        ASKED,
        ASKED,
        ASKED,
        REVIEWED,
      ]);
      expect(turn.decisions).toEqual([
        { callId: "lookalike", toolName: "Write", allowedBy: "auto_approved" },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "leaves a dependency file edit to Auto review when the setting is off",
    async () => {
      const turn = await runTurn(
        [
          {
            id: "manifest",
            name: "Write",
            input: { file_path: "package.json" },
          },
        ],
        DEPENDENCY_ASK_OFF,
      );
      expect(turn.prompts).toEqual([]);
      expect(turn.tools).toMatchObject([REVIEWED]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps Builder deletions and block removals on canUseTool, where their own gate asks",
    async () => {
      const turn = await runTurn([
        { id: "delete", name: `${MCP}builder_delete_page`, input: {} },
        { id: "remove", name: `${MCP}builder_remove_block`, input: {} },
      ]);
      expect(turn.tools).toMatchObject([ASKED, ASKED]);
      expect(turn.announced).toEqual(["delete", "remove"]);
    },
    TEST_TIMEOUT_MS,
  );
}

function registerFirstPartyAndWebTests() {
  it(
    "announces first-party tools to the call ledger and records them as in Ask first",
    async () => {
      const turn = await runTurn([
        { id: "add", name: `${MCP}builder_add_block`, input: {} },
        { id: "list", name: `${MCP}builder_list_pages`, input: {} },
      ]);
      expect(turn.announced).toEqual(["add", "list"]);
      expect(turn.decisions).toEqual([
        {
          callId: "add",
          toolName: `${MCP}builder_add_block`,
          allowedBy: "builder_auto",
        },
        {
          callId: "list",
          toolName: `${MCP}builder_list_pages`,
          allowedBy: "read_auto",
        },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "sends the built-in question tool to canUseTool, never counting it as Auto review's",
    async () => {
      const turn = await runTurn([
        { id: "question", name: "AskUserQuestion", input: { questions: [] } },
      ]);
      expect(turn.tools).toMatchObject([REFUSED_WHEN_ASKED]);
      expect(turn.decisions).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "asks before reading outside the project, and reads inside it unasked",
    async () => {
      const turn = await runTurn([
        { id: "outside", name: "Read", input: { file_path: "/etc/hostname" } },
        { id: "inside", name: "Read", input: { file_path: join(dir, "a.ts") } },
      ]);
      expect(turn.prompts.map((p) => p.callId)).toEqual(["outside"]);
      expect(turn.tools).toMatchObject([ASKED, UNREVIEWED]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "asks before web access in Safe scope",
    async () => {
      setBuilderAvailable(true);
      const turn = await runTurn(
        [{ id: "web", name: "WebFetch", input: WEB_PAGE }],
        { settings: { generationMode: "safe" } },
      );
      expect(turn.prompts.map((p) => p.callId)).toEqual(["web"]);
      expect(turn.tools).toMatchObject([ASKED]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "leaves web access to Auto review in Code scope",
    async () => {
      setBuilderAvailable(true);
      const turn = await runTurn([
        { id: "web", name: "WebFetch", input: WEB_PAGE },
      ]);
      expect(turn.prompts).toEqual([]);
      expect(turn.tools).toMatchObject([REVIEWED]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "credits Auto review with no call the CLI runs without any review",
    async () => {
      const turn = await runTurn([
        { id: "search", name: "ToolSearch", input: { query: "builder" } },
      ]);
      expect(turn.prompts).toEqual([]);
      expect(turn.decisions).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "records a call Auto review refused as its refusal, after the approval the hook noted",
    async () => {
      const turn = await runTurn([
        {
          id: "risky",
          name: "Write",
          input: { file_path: "scripts/install.sh" },
          refusedBy: "classifier",
        },
      ]);
      expect(turn.tools).toMatchObject([REFUSED_IN_REVIEW]);
      expect(turn.decisions.map((d) => d.allowedBy)).toEqual([
        "auto_approved",
        "auto_denied",
      ]);
      expect(turn.decisions.at(-1)).toMatchObject({ callId: "risky" });
    },
    TEST_TIMEOUT_MS,
  );
}

describe("the permission modes on the Claude provider", () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-auto-review-"));
    traceFile = join(dir, "trace.jsonl");
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

  registerModePromptTests();
  registerAlwaysAskCommandTests();
  registerDependencyFileTests();
  registerFirstPartyAndWebTests();
});
