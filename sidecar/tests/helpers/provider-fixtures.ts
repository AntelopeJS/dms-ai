import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProviderName } from "../../src/state/types.js";

const CLAUDE_SCRIPTS = "../fixtures/mock-claude/scripts";
const CODEX_DUMPS = "../fixtures/codex-dumps";
const CODEX_SCRIPTS = "../fixtures/mock-codex/scripts";
const SCRIPT_SEPARATOR = ",";

/**
 * What a turn should do, named by intent rather than by file: each provider
 * answers it with its own recording.
 *
 * - `simple`: text only, no tool at all.
 * - `plain`: a tool call that needs no decision, then a final message.
 * - `edit`: a file edit, which is what drives the host's change animation.
 * - `permission`: a tool call that stops on a permission prompt.
 * - `failing`: a turn that ends in failure rather than success.
 */
export type TurnKind =
  | "simple"
  | "plain"
  | "edit"
  | "permission"
  | "permission-twice"
  | "failing";

export interface ProviderFixture {
  name: ProviderName;
  /** Points the provider's mock at the recording for that kind of turn. */
  use(kind: TurnKind): void;
  reset(): void;
}

function fixtureFor(dir: string, file: string): string {
  return resolve(import.meta.dirname, dir, file);
}

// The mock SDK replays its script once per session, and a session is recreated
// on the turn that follows its end, so one script covers a repeated turn too.
const CLAUDE_BY_KIND: Record<TurnKind, string> = {
  simple: fixtureFor(CLAUDE_SCRIPTS, "list-files.json"),
  plain: fixtureFor(CLAUDE_SCRIPTS, "list-files.json"),
  edit: fixtureFor(CLAUDE_SCRIPTS, "edit-file.json"),
  permission: fixtureFor(CLAUDE_SCRIPTS, "permission-required.json"),
  "permission-twice": fixtureFor(CLAUDE_SCRIPTS, "permission-required.json"),
  failing: fixtureFor(CLAUDE_SCRIPTS, "does-not-exist.json"),
};

// The fake binary replays one recorded turn per turn/start, so a repeated turn
// is the same capture listed twice.
const DENIED_DUMP = "recette-3-command-denied.jsonl";

const CODEX_BY_KIND: Record<TurnKind, string> = {
  simple: fixtureFor(CODEX_DUMPS, "recette-1-simple-message.jsonl"),
  plain: fixtureFor(CODEX_DUMPS, "recette-2-file-edit.jsonl"),
  edit: fixtureFor(CODEX_DUMPS, "recette-2-file-edit.jsonl"),
  permission: fixtureFor(CODEX_DUMPS, DENIED_DUMP),
  "permission-twice": [
    fixtureFor(CODEX_DUMPS, DENIED_DUMP),
    fixtureFor(CODEX_DUMPS, DENIED_DUMP),
  ].join(SCRIPT_SEPARATOR),
  failing: fixtureFor(CODEX_SCRIPTS, "turn-failed.jsonl"),
};

const claudeFixture: ProviderFixture = {
  name: "claude",
  use: (kind) => {
    process.env.MOCK_CLAUDE = "1";
    process.env.MOCK_CLAUDE_SCRIPT = CLAUDE_BY_KIND[kind];
  },
  reset: () => {
    delete process.env.MOCK_CLAUDE;
    delete process.env.MOCK_CLAUDE_SCRIPT;
    delete process.env.MOCK_CLAUDE_TRACE;
  },
};

const MOCK_API_KEY = "sk-mock";

// The API key is an environment prerequisite in production too, and the
// availability check reads it from there. A machine that already has a real key
// keeps it.
let injectedApiKey = false;

const codexFixture: ProviderFixture = {
  name: "codex",
  use: (kind) => {
    process.env.MOCK_CODEX = "1";
    process.env.MOCK_CODEX_SCRIPT = CODEX_BY_KIND[kind];
    if (process.env.OPENAI_API_KEY !== undefined) return;
    process.env.OPENAI_API_KEY = MOCK_API_KEY;
    injectedApiKey = true;
  },
  reset: () => {
    delete process.env.MOCK_CODEX;
    delete process.env.MOCK_CODEX_SCRIPT;
    delete process.env.MOCK_CODEX_TRACE;
    if (!injectedApiKey) return;
    delete process.env.OPENAI_API_KEY;
    injectedApiKey = false;
  },
};

export const PROVIDER_FIXTURES: ProviderFixture[] = [
  claudeFixture,
  codexFixture,
];

export const CODEX_FIXTURE = codexFixture;

/** Joins several recordings into one script: one turn per file, in order. */
export function codexTurns(...files: string[]): string {
  return files
    .map((file) => fixtureFor(CODEX_DUMPS, file))
    .join(SCRIPT_SEPARATOR);
}

export function codexScript(file: string): string {
  return fixtureFor(CODEX_SCRIPTS, file);
}

export interface TracedRequest {
  kind: string;
  method?: string;
  params?: Record<string, unknown>;
  decision?: unknown;
}

/**
 * What the fake binary saw. The sidecar drives it exactly as it drives the real
 * one, so the trace is how a scenario checks what was actually sent — turn
 * overrides, disabled skills, the rendering of an attachment.
 */
export function readCodexTrace(file: string): TracedRequest[] {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as TracedRequest);
  } catch {
    return [];
  }
}

export function traceCodexInto(file: string): void {
  process.env.MOCK_CODEX_TRACE = file;
}

const TRACE_ARMERS: Record<ProviderName, (file: string) => void> = {
  claude: (file) => {
    process.env.MOCK_CLAUDE_TRACE = file;
  },
  codex: traceCodexInto,
};

const TRACE_READERS: Record<ProviderName, (file: string) => unknown[]> = {
  claude: (file) => readClaudeTrace(file),
  codex: (file) => readCodexTrace(file),
};

/** Arms the trace of one provider only: the other's would outlive its fixture. */
export function traceInto(provider: ProviderName, file: string): void {
  TRACE_ARMERS[provider](file);
}

/** What that provider's backend was asked to do, as raw JSON. */
export function readTrace(provider: ProviderName, file: string): string {
  return JSON.stringify(TRACE_READERS[provider](file));
}

export interface TracedClaudeSession {
  kind: string;
  plugins?: { path: string }[];
  skills?: string[];
}

/** What the SDK was asked to load, the Claude counterpart of the Codex trace. */
export function readClaudeTrace(file: string): TracedClaudeSession[] {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as TracedClaudeSession);
  } catch {
    return [];
  }
}

export function traceClaudeInto(file: string): void {
  process.env.MOCK_CLAUDE_TRACE = file;
}
