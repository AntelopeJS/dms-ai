import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CanUseTool,
  McpServerConfig,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  MOCK_ABORT_REASON,
  MOCK_CAN_USE_TOOL_BEHAVIOR_ALLOW,
  MOCK_DEFAULT_SCRIPT_RELATIVE,
  MOCK_INTERRUPTED_RESULT,
  MOCK_SCRIPT_ENV_VAR,
  MOCK_STREAM_DELAY_MS,
  MOCK_TRACE_ENV_VAR,
} from "./constants.js";

const here = dirname(fileURLToPath(import.meta.url));

export interface MockQueryParams {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}

export interface MockQueryParamsWithScript extends MockQueryParams {
  scriptPath?: string;
}

function resolveScriptPath(explicit: string | undefined): string {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const fromEnv = process.env[MOCK_SCRIPT_ENV_VAR];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return resolve(here, MOCK_DEFAULT_SCRIPT_RELATIVE);
}

async function loadScript(path: string): Promise<SDKMessage[]> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`mock-claude: script ${path} must be a JSON array`);
  }
  return parsed as SDKMessage[];
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, rejectDelay) => {
    if (signal?.aborted === true) {
      rejectDelay(new Error(MOCK_ABORT_REASON));
      return;
    }
    const timer = setTimeout(resolveDelay, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      rejectDelay(new Error(MOCK_ABORT_REASON));
    });
  });
}

function unsupported(method: string): () => Promise<never> {
  return async () => {
    throw new Error(`mock-claude: ${method}() is not implemented`);
  };
}

interface BuildMockQueryArgs {
  prompt: string | AsyncIterable<SDKUserMessage>;
  scriptPath: string;
  signal?: AbortSignal;
  canUseTool?: CanUseTool;
  mcpServers?: Record<string, McpServerConfig>;
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

function isToolUseBlock(value: unknown): value is ToolUseBlock {
  if (value === null || typeof value !== "object") return false;
  return (value as { type?: string }).type === "tool_use";
}

function extractToolUseBlocks(message: SDKMessage): ToolUseBlock[] {
  if (message.type !== "assistant") return [];
  const content = (message.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.filter(isToolUseBlock);
}

function extractToolResultId(message: SDKMessage): string | null {
  if (message.type !== "user") return null;
  const content = (message.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    const candidate = block as { type?: string; tool_use_id?: string };
    if (
      candidate.type === "tool_result" &&
      typeof candidate.tool_use_id === "string"
    ) {
      return candidate.tool_use_id;
    }
  }
  return null;
}

interface PermissionContext {
  canUseTool: CanUseTool;
  signal: AbortSignal;
  deniedToolIds: Set<string>;
}

async function evaluateBlock(
  block: ToolUseBlock,
  ctx: PermissionContext,
): Promise<boolean> {
  const result: PermissionResult = await ctx.canUseTool(
    block.name,
    block.input,
    { signal: ctx.signal, toolUseID: block.id },
  );
  if (result.behavior === MOCK_CAN_USE_TOOL_BEHAVIOR_ALLOW) return true;
  ctx.deniedToolIds.add(block.id);
  return false;
}

async function shouldEmitMessage(
  message: SDKMessage,
  ctx: PermissionContext | null,
): Promise<boolean> {
  if (ctx === null) return true;
  if (message.type === "user") {
    const id = extractToolResultId(message);
    if (id !== null && ctx.deniedToolIds.has(id)) return false;
    return true;
  }
  const blocks = extractToolUseBlocks(message);
  if (blocks.length === 0) return true;
  for (const block of blocks) {
    const allowed = await evaluateBlock(block, ctx);
    if (!allowed) return false;
  }
  return true;
}

function buildPermissionContext(
  args: BuildMockQueryArgs,
): PermissionContext | null {
  if (args.canUseTool === undefined) return null;
  const signal = args.signal ?? new AbortController().signal;
  return {
    canUseTool: args.canUseTool,
    signal,
    deniedToolIds: new Set<string>(),
  };
}

interface InterruptFlag {
  requested: boolean;
}

// The real SDK answers an interrupt by ending the turn with a result message,
// which is what lets the session close the turn instead of hard-aborting it.
function buildInterruptedResult(): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: MOCK_INTERRUPTED_RESULT,
    usage: {},
  } as unknown as SDKMessage;
}

async function* replayOnce(
  entries: SDKMessage[],
  args: BuildMockQueryArgs,
  interrupted: InterruptFlag,
): AsyncGenerator<SDKMessage, void> {
  const permCtx = buildPermissionContext(args);
  for (const entry of entries) {
    await delay(MOCK_STREAM_DELAY_MS, args.signal);
    if (interrupted.requested) {
      interrupted.requested = false;
      yield buildInterruptedResult();
      return;
    }
    const allowed = await shouldEmitMessage(entry, permCtx);
    if (!allowed) continue;
    yield entry;
  }
}

// One replay per user turn, as the real SDK serves several turns from a single
// query: the session stays alive between them, which is what a scenario about a
// second turn needs.
async function* createMessageStream(
  args: BuildMockQueryArgs,
  interrupted: InterruptFlag,
): AsyncGenerator<SDKMessage, void> {
  const entries = await loadScript(args.scriptPath);
  if (typeof args.prompt === "string") {
    yield* replayOnce(entries, args, interrupted);
    return;
  }
  for await (const _turn of args.prompt) {
    yield* replayOnce(entries, args, interrupted);
  }
}

function buildControlSurface(
  interrupted: InterruptFlag,
): Omit<Query, keyof AsyncGenerator<SDKMessage, void>> {
  return {
    interrupt: async () => {
      interrupted.requested = true;
    },
    setPermissionMode: unsupported("setPermissionMode"),
    setModel: unsupported("setModel"),
    setMaxThinkingTokens: unsupported("setMaxThinkingTokens"),
    applyFlagSettings: unsupported("applyFlagSettings"),
    initializationResult: unsupported("initializationResult"),
    supportedCommands: unsupported("supportedCommands"),
    supportedModels: unsupported("supportedModels"),
    supportedAgents: unsupported("supportedAgents"),
    mcpServerStatus: unsupported("mcpServerStatus"),
    getContextUsage: unsupported("getContextUsage"),
    readFile: unsupported("readFile"),
  } as unknown as Omit<Query, keyof AsyncGenerator<SDKMessage, void>>;
}

function buildQuery(args: BuildMockQueryArgs): Query {
  const interrupted: InterruptFlag = { requested: false };
  const stream = createMessageStream(args, interrupted);
  return Object.assign(stream, buildControlSurface(interrupted)) as Query;
}

function traceOptions(options: Options | undefined): void {
  const file = process.env[MOCK_TRACE_ENV_VAR];
  if (file === undefined || options === undefined) return;
  const entry = {
    kind: "session",
    permissionMode: options.permissionMode,
    plugins: options.plugins,
    skills: options.skills,
    mcpServers: Object.keys(options.mcpServers ?? {}),
  };
  try {
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // Same as the Codex mock: tracing is never worth failing a session for.
  }
}

export function query(params: MockQueryParamsWithScript): Query {
  const opts = params.options;
  traceOptions(opts);
  return buildQuery({
    prompt: params.prompt,
    scriptPath: resolveScriptPath(params.scriptPath),
    signal: opts?.abortController?.signal,
    canUseTool: opts?.canUseTool,
    mcpServers: opts?.mcpServers,
  });
}

export type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
