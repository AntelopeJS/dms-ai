import { homedir } from "node:os";
import { join } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolArgs } from "../../src/agent/edit-targets.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { MCP_TOOL_NAME_PREFIX } from "../../src/constants/mcp.js";
import { buildSafeModeHooks } from "../../src/providers/claude/safe-mode.js";
import type {
  AppSettings,
  ChatMode,
  GenerationMode,
} from "../../src/state/settings-types.js";
import { TURN_SETTINGS } from "../helpers/turn-settings.js";

const ROOT = "/work/app";
const ASK = "ask";
const DENY = "deny";
const NONE = "none";

interface Call {
  name: string;
  input: ToolArgs;
}

const call = (name: string, input: ToolArgs = {}): Call => ({
  name,
  input,
});

const INSTALL = "npm install is-odd";

const COMMAND_RUNNERS: Call[] = [
  call("Monitor", { command: INSTALL, description: "install", timeout_ms: 1 }),
  call("PowerShell", { command: INSTALL }),
  call("CronCreate", { cron: "* * * * *", prompt: `run ${INSTALL}` }),
  call("ScheduleWakeup", { delaySeconds: 60, prompt: INSTALL }),
  call("RemoteTrigger", { action: "run", trigger_id: "t1" }),
  call("Workflow", { script: "export const meta = {}" }),
];

const OUTSIDE_REACHERS: Call[] = [
  call("SendMessage", { to: "peer", message: INSTALL }),
  call("EnterWorktree", { name: "side" }),
  call("PushNotification", { message: "hi", status: "proactive" }),
  call("Agent", { prompt: INSTALL, isolation: "remote" }),
  call("Agent", { prompt: INSTALL, isolation: "worktree" }),
];

const UNKNOWN_TOOLS: Call[] = [
  call("ToolTheCliAddsNext", { command: INSTALL }),
  call("mcp__acme__Frobnicate", { target: "home" }),
  call("mcp__other__builder_delete_page", { target: "home" }),
];

const INSTALL_HOOK_FILES: Call[] = [
  ".pnpmfile.cjs",
  ".yarnrc.yml",
  ".yarnrc",
  "bunfig.toml",
].map((file) => call("Write", { file_path: join(ROOT, file), content: "" }));

const write = (path: string): Call =>
  call("Write", { file_path: path, content: "" });

const COMMANDS: Call[] = [
  call("Bash", { command: "cat package.json" }),
  call("Bash", { command: "ls -la" }),
  call("Bash", { command: "touch b.txt" }),
  call("Monitor", {
    command: "tail -f log",
    description: "log",
    timeout_ms: 1,
  }),
  call("PowerShell", { command: "Get-ChildItem" }),
  call("LSP", { operation: "hover", filePath: join(ROOT, "a.ts") }),
];

const GIT_HOOK_FILES: Call[] = [
  write(join(ROOT, ".git", "hooks", "pre-commit")),
  write(".git/hooks/pre-push"),
  write(join(ROOT, "src", "..", ".git", "hooks", "commit-msg")),
  write(join(ROOT, ".GIT", "Hooks", "pre-commit")),
  write("/elsewhere/repo/.git/hooks/post-checkout"),
  write(join(ROOT, ".git", "modules", "sub", "hooks", "pre-commit")),
  write(join(ROOT, ".git", "modules", "sub", "config")),
  write(join(ROOT, ".git", "worktrees", "w", "config.worktree")),
  write(join(ROOT, "vendor", "x", ".git", "hooks", "h")),
  write("src/../vendor/../.git/modules/sub/hooks/pre-commit"),
  call("Edit", {
    file_path: join(ROOT, ".git", "config"),
    old_string: "a",
    new_string: "b",
  }),
  write(join(ROOT, ".husky", "pre-commit")),
  write(join(ROOT, ".husky", "_", "husky.sh")),
  write(join(ROOT, "lefthook.yml")),
  write(join(ROOT, ".lefthook-local.yaml")),
  write(join(ROOT, ".pre-commit-config.yaml")),
];

const DEPENDENCY_FILES: Call[] = [
  write(join(ROOT, "package.json")),
  write("src/../PACKAGE.JSON"),
  write(join(ROOT, "pnpm-lock.yaml")),
];

const LEFT_TO_THE_CLI: Call[] = [
  write(join(ROOT, "src", "a.ts")),
  write(join(ROOT, "src", "hooks", "pre-commit.ts")),
  write(join(ROOT, ".github", "workflows", "config")),
  write(join(ROOT, ".gitignore")),
  write(join(ROOT, "src", ".github", "config")),
  write(join(ROOT, "my-lefthook.yml")),
  call("Read", { file_path: join(ROOT, "package.json") }),
  call("WebFetch", { url: "https://example.com", prompt: "read" }),
  call("CronCreate", { cron: "* * * * *", prompt: "hi" }),
  call("ToolSearch", { query: "select:Monitor" }),
];

const SAFE_SCOPE_CALLS: Call[] = [
  call("Read", { file_path: join(ROOT, "a.ts") }),
  call("WebFetch", { url: "https://example.com", prompt: "read" }),
  call("Agent", { prompt: "look around" }),
  call("ToolSearch", { query: "select:Monitor" }),
  call("Skill", { skill: "dms-ai" }),
  call("AskUserQuestion", { questions: [] }),
  call(`${MCP_TOOL_NAME_PREFIX}builder_add_block`, {}),
  call("Write", { file_path: join(homedir(), ".claude", "plans", "p.md") }),
];

async function decide(
  { name, input }: Call,
  mode: ChatMode,
  generationMode: GenerationMode,
  settings: Partial<AppSettings> = {},
): Promise<string> {
  const hooks = buildSafeModeHooks({
    getSettings: () => ({
      ...TURN_SETTINGS,
      ...settings,
      mode,
      generationMode,
    }),
    readRoots: [ROOT],
    hostProjectRoot: ROOT,
  });
  const [matcher] = hooks.PreToolUse ?? [];
  const hookInput: PreToolUseHookInput = {
    session_id: "session-1",
    transcript_path: "",
    cwd: ROOT,
    hook_event_name: "PreToolUse",
    tool_name: name,
    tool_use_id: "call-1",
    tool_input: input,
    permission_mode: mode === "normal" ? "default" : mode,
  };
  const output = await matcher.hooks[0](hookInput, "call-1", {
    signal: new AbortController().signal,
  });
  if (!("hookSpecificOutput" in output)) return NONE;
  const specific = output.hookSpecificOutput;
  if (specific === undefined || !("permissionDecision" in specific)) {
    return NONE;
  }
  return specific.permissionDecision ?? NONE;
}

async function decideAll(
  calls: Call[],
  mode: ChatMode,
  generationMode: GenerationMode,
  settings: Partial<AppSettings> = {},
): Promise<Array<[string, string]>> {
  return Promise.all(
    calls.map(async (c): Promise<[string, string]> => [
      c.name,
      await decide(c, mode, generationMode, settings),
    ]),
  );
}

const each = (calls: Call[], decision: string): Array<[string, string]> =>
  calls.map((c) => [c.name, decision]);

describe("the PreToolUse guard under Auto review in Code scope", () => {
  it("hands every tool that runs or schedules a command to the person", async () => {
    expect(await decideAll(COMMAND_RUNNERS, "auto", "vibe")).toEqual(
      each(COMMAND_RUNNERS, ASK),
    );
  });

  it("hands every tool that acts outside the conversation to the person", async () => {
    expect(await decideAll(OUTSIDE_REACHERS, "auto", "vibe")).toEqual(
      each(OUTSIDE_REACHERS, ASK),
    );
  });

  it("hands a tool it does not know to the person, another MCP server's included", async () => {
    expect(await decideAll(UNKNOWN_TOOLS, "auto", "vibe")).toEqual(
      each(UNKNOWN_TOOLS, ASK),
    );
  });

  it("hands an edit of a file the package manager runs at install time to the person", async () => {
    expect(await decideAll(INSTALL_HOOK_FILES, "auto", "vibe")).toEqual(
      each(INSTALL_HOOK_FILES, ASK),
    );
  });

  it("leaves ordinary edits, web access, sub-agents and inert tools to the classifier", async () => {
    const reviewable = [
      call("Write", { file_path: join(ROOT, "src", "a.ts"), content: "" }),
      call("WebSearch", { query: "pnpm" }),
      call("Agent", { prompt: "look around" }),
      call("ToolSearch", { query: "select:Monitor" }),
      call("TodoWrite", { todos: [] }),
      call("Skill", { skill: "dms-ai" }),
    ];
    expect(await decideAll(reviewable, "auto", "vibe")).toEqual(
      each(reviewable, NONE),
    );
  });

  it("hands an edit of a git hook file to the person", async () => {
    expect(await decideAll(GIT_HOOK_FILES, "auto", "vibe")).toEqual(
      each(GIT_HOOK_FILES, ASK),
    );
  });
});

describe.each<ChatMode>(["normal", "acceptEdits"])(
  "the PreToolUse guard in %s mode in Code scope",
  (mode) => {
    it("hands every command to the person, read-only ones included", async () => {
      expect(await decideAll(COMMANDS, mode, "vibe")).toEqual(
        each(COMMANDS, ASK),
      );
    });

    it("hands an edit of a git hook or dependency file to the person", async () => {
      const files = [...GIT_HOOK_FILES, ...DEPENDENCY_FILES];
      expect(await decideAll(files, mode, "vibe")).toEqual(each(files, ASK));
    });

    it("hands a tool it does not know to the person", async () => {
      expect(await decideAll(UNKNOWN_TOOLS, mode, "vibe")).toEqual(
        each(UNKNOWN_TOOLS, ASK),
      );
    });

    it("leaves ordinary edits, reads, web access and scheduling to the CLI", async () => {
      expect(await decideAll(LEFT_TO_THE_CLI, mode, "vibe")).toEqual(
        each(LEFT_TO_THE_CLI, NONE),
      );
    });

    it("still asks before a git hook edit when dependency files no longer ask", async () => {
      const settings = { alwaysAskDependencies: false };
      expect(await decideAll(DEPENDENCY_FILES, mode, "vibe", settings)).toEqual(
        each(DEPENDENCY_FILES, NONE),
      );
      expect(await decideAll(GIT_HOOK_FILES, mode, "vibe", settings)).toEqual(
        each(GIT_HOOK_FILES, ASK),
      );
    });
  },
);

describe("the PreToolUse guard in Plan only", () => {
  it("leaves every call to the CLI, which changes nothing", async () => {
    const calls = [...COMMANDS, ...GIT_HOOK_FILES, ...UNKNOWN_TOOLS];
    expect(await decideAll(calls, "plan", "vibe")).toEqual(each(calls, NONE));
  });
});

describe("the PreToolUse guard in Safe scope", () => {
  beforeEach(() => setBuilderAvailable(true));
  afterEach(() => setBuilderAvailable(false));

  const refused: Call[] = [
    ...COMMAND_RUNNERS,
    ...OUTSIDE_REACHERS,
    ...UNKNOWN_TOOLS,
    call("Bash", { command: "ls" }),
    call("Write", { file_path: join(ROOT, "src", "a.ts"), content: "" }),
  ];

  it.each<ChatMode>(["normal", "auto", "acceptEdits", "plan"])(
    "refuses every command, edit, outside reach and unknown tool in %s mode",
    async (mode) => {
      expect(await decideAll(refused, mode, "safe")).toEqual(
        each(refused, DENY),
      );
    },
  );

  it("lets reads, web lookups, sub-agents, inert and first-party tools through", async () => {
    const decisions = await decideAll(SAFE_SCOPE_CALLS, "normal", "safe");
    expect(decisions.filter(([, decision]) => decision === DENY)).toEqual([]);
  });
});
