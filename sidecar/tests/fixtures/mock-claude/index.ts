import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CanUseTool,
  HookCallback,
  HookJSONOutput,
  McpServerConfig,
  Options,
  PermissionMode,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  MOCK_ABORT_REASON,
  MOCK_ACCEPT_EDITS_COMMANDS,
  MOCK_ACCEPT_EDITS_MODE,
  MOCK_ACCEPT_EDITS_TOOLS,
  MOCK_BYPASS_MODE,
  MOCK_BYPASS_UNAVAILABLE_ERROR,
  MOCK_CAN_USE_TOOL_BEHAVIOR_ALLOW,
  MOCK_DEFAULT_MODE,
  MOCK_DEFAULT_SCRIPT_RELATIVE,
  MOCK_HOOK_DENY,
  MOCK_INTERRUPTED_RESULT,
  MOCK_PLAN_MODE,
  MOCK_PRE_TOOL_USE_EVENT,
  MOCK_READ_ONLY_COMMANDS,
  MOCK_SCRIPT_ENV_VAR,
  MOCK_SHELL_COMMAND_ARG,
  MOCK_SHELL_TOOL,
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
  const parsed: unknown = JSON.parse(raw);
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

/**
 * The permission mode of one query, as the CLI keeps it: bypassing stays
 * available for the life of a process launched in `bypassPermissions`.
 */
interface PermissionState {
  mode: PermissionMode;
  isBypassAvailable: boolean;
}

interface BuildMockQueryArgs {
  prompt: string | AsyncIterable<SDKUserMessage>;
  scriptPath: string;
  signal?: AbortSignal;
  canUseTool?: CanUseTool;
  preToolUseHooks: HookCallback[];
  permissions: PermissionState;
  mcpServers?: Record<string, McpServerConfig>;
}

const TOOL_USE_BLOCK = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});

type ToolUseBlock = z.infer<typeof TOOL_USE_BLOCK>;

const TOOL_RESULT_REFERENCE = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
});

const SHELL_COMMAND = z.string().catch("");

function isToolUseBlock(value: unknown): value is ToolUseBlock {
  return TOOL_USE_BLOCK.safeParse(value).success;
}

function extractToolUseBlocks(message: SDKMessage): ToolUseBlock[] {
  if (message.type !== "assistant") return [];
  const content = message.message.content;
  if (!Array.isArray(content)) return [];
  return content.filter(isToolUseBlock);
}

function extractToolResultId(message: SDKMessage): string | null {
  if (message.type !== "user") return null;
  const content = message.message.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    const reference = TOOL_RESULT_REFERENCE.safeParse(block);
    if (reference.success) return reference.data.tool_use_id;
  }
  return null;
}

interface PermissionContext {
  canUseTool?: CanUseTool;
  preToolUseHooks: HookCallback[];
  permissions: PermissionState;
  signal: AbortSignal;
  deniedToolIds: Set<string>;
}

type DecidingLayer = "hook" | "readOnly" | "mode" | "canUseTool" | "none";

interface ToolDecision {
  decidedBy: DecidingLayer;
  isAllowed: boolean;
}

function isHookDenial(output: HookJSONOutput): boolean {
  if (!("hookSpecificOutput" in output)) return false;
  const specific = output.hookSpecificOutput;
  return (
    specific !== undefined &&
    "permissionDecision" in specific &&
    specific.permissionDecision === MOCK_HOOK_DENY
  );
}

async function isDeniedByHooks(
  block: ToolUseBlock,
  ctx: PermissionContext,
): Promise<boolean> {
  const input = {
    hook_event_name: MOCK_PRE_TOOL_USE_EVENT,
    tool_name: block.name,
    tool_input: block.input,
    tool_use_id: block.id,
    session_id: "",
    transcript_path: "",
    cwd: process.cwd(),
    permission_mode: ctx.permissions.mode,
  } as const;
  for (const hook of ctx.preToolUseHooks) {
    const output = await hook(input, block.id, { signal: ctx.signal });
    if (isHookDenial(output)) return true;
  }
  return false;
}

function shellProgram(block: ToolUseBlock): string | null {
  if (block.name !== MOCK_SHELL_TOOL) return null;
  const command = SHELL_COMMAND.parse(block.input[MOCK_SHELL_COMMAND_ARG]);
  const [program] = command.trim().split(/\s+/);
  return program ?? null;
}

function isFilesystemCommand(block: ToolUseBlock): boolean {
  return MOCK_ACCEPT_EDITS_COMMANDS.includes(shellProgram(block) ?? "");
}

function isReadOnlyCommand(block: ToolUseBlock): boolean {
  return MOCK_READ_ONLY_COMMANDS.includes(shellProgram(block) ?? "");
}

type ModeApproval = (
  block: ToolUseBlock,
  permissions: PermissionState,
) => boolean;

const APPROVED_BY_MODE: Partial<Record<PermissionMode, ModeApproval>> = {
  [MOCK_BYPASS_MODE]: () => true,
  [MOCK_PLAN_MODE]: (_block, permissions) => permissions.isBypassAvailable,
  [MOCK_ACCEPT_EDITS_MODE]: (block) =>
    MOCK_ACCEPT_EDITS_TOOLS.includes(block.name) || isFilesystemCommand(block),
};

function isApprovedByMode(
  block: ToolUseBlock,
  permissions: PermissionState,
): boolean {
  return APPROVED_BY_MODE[permissions.mode]?.(block, permissions) ?? false;
}

async function askCanUseTool(
  block: ToolUseBlock,
  ctx: PermissionContext,
): Promise<ToolDecision> {
  if (ctx.canUseTool === undefined)
    return { decidedBy: "none", isAllowed: true };
  const result: PermissionResult = await ctx.canUseTool(
    block.name,
    block.input,
    { signal: ctx.signal, toolUseID: block.id },
  );
  const isAllowed = result.behavior === MOCK_CAN_USE_TOOL_BEHAVIOR_ALLOW;
  return { decidedBy: "canUseTool", isAllowed };
}

/**
 * The CLI's order: hooks first, then the commands it deems read-only, then the
 * permission mode, then `canUseTool`.
 */
async function decide(
  block: ToolUseBlock,
  ctx: PermissionContext,
): Promise<ToolDecision> {
  if (await isDeniedByHooks(block, ctx)) {
    return { decidedBy: "hook", isAllowed: false };
  }
  if (isReadOnlyCommand(block)) {
    return { decidedBy: "readOnly", isAllowed: true };
  }
  if (isApprovedByMode(block, ctx.permissions)) {
    return { decidedBy: "mode", isAllowed: true };
  }
  return askCanUseTool(block, ctx);
}

async function evaluateBlock(
  block: ToolUseBlock,
  ctx: PermissionContext,
): Promise<boolean> {
  const decision = await decide(block, ctx);
  appendTrace({ kind: "tool", name: block.name, ...decision });
  if (decision.isAllowed) return true;
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
  if (args.canUseTool === undefined && args.preToolUseHooks.length === 0) {
    return null;
  }
  const signal = args.signal ?? new AbortController().signal;
  return {
    canUseTool: args.canUseTool,
    preToolUseHooks: args.preToolUseHooks,
    permissions: args.permissions,
    signal,
    deniedToolIds: new Set<string>(),
  };
}

interface InterruptFlag {
  requested: boolean;
}

/**
 * The real SDK answers an interrupt by ending the turn with a result message,
 * which is what lets the session close the turn instead of hard-aborting it.
 */
function buildInterruptedResult(): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 0,
    result: MOCK_INTERRUPTED_RESULT,
    stop_reason: null,
    total_cost_usd: 0,
    usage: {
      cache_creation: {
        ephemeral_1h_input_tokens: 0,
        ephemeral_5m_input_tokens: 0,
      },
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      inference_geo: "",
      input_tokens: 0,
      iterations: [],
      output_tokens: 0,
      server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
      service_tier: "standard",
      speed: "standard",
    },
    modelUsage: {},
    permission_denials: [],
    uuid: randomUUID(),
    session_id: "",
  };
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

function isTextPrompt(prompt: MockQueryParams["prompt"]): prompt is string {
  return typeof prompt === "string";
}

/**
 * One replay per user turn, as the real SDK serves several turns from a single
 * query: the session stays alive between them, which is what a scenario about a
 * second turn needs.
 */
async function* createMessageStream(
  args: BuildMockQueryArgs,
  interrupted: InterruptFlag,
): AsyncGenerator<SDKMessage, void> {
  const entries = await loadScript(args.scriptPath);
  if (isTextPrompt(args.prompt)) {
    yield* replayOnce(entries, args, interrupted);
    return;
  }
  for await (const _turn of args.prompt) {
    yield* replayOnce(entries, args, interrupted);
  }
}

function setPermissionMode(
  permissions: PermissionState,
  mode: PermissionMode,
): Promise<void> {
  if (mode === MOCK_BYPASS_MODE && !permissions.isBypassAvailable) {
    return Promise.reject(new Error(MOCK_BYPASS_UNAVAILABLE_ERROR));
  }
  permissions.mode = mode;
  appendTrace({ kind: "permission_mode", permissionMode: mode });
  return Promise.resolve();
}

function buildControlSurface(
  interrupted: InterruptFlag,
  permissions: PermissionState,
): Omit<Query, keyof AsyncGenerator<SDKMessage, void>> {
  return {
    interrupt: async () => {
      interrupted.requested = true;
    },
    setPermissionMode: (mode: PermissionMode) =>
      setPermissionMode(permissions, mode),
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
    reloadPlugins: unsupported("reloadPlugins"),
    accountInfo: unsupported("accountInfo"),
    rewindFiles: unsupported("rewindFiles"),
    seedReadState: unsupported("seedReadState"),
    reconnectMcpServer: unsupported("reconnectMcpServer"),
    toggleMcpServer: unsupported("toggleMcpServer"),
    setMcpServers: unsupported("setMcpServers"),
    streamInput: unsupported("streamInput"),
    stopTask: unsupported("stopTask"),
    backgroundTasks: unsupported("backgroundTasks"),
    close: unsupported("close"),
  };
}

function buildQuery(args: BuildMockQueryArgs): Query {
  const interrupted: InterruptFlag = { requested: false };
  const stream = createMessageStream(args, interrupted);
  const control = buildControlSurface(interrupted, args.permissions);
  return Object.assign(stream, control);
}

interface TraceEntry {
  kind: string;
  name?: string;
  decidedBy?: DecidingLayer;
  isAllowed?: boolean;
  permissionMode?: PermissionMode;
  plugins?: Options["plugins"];
  skills?: Options["skills"];
  mcpServers?: string[];
}

/**
 * Appends one entry to the trace file named by the environment, if any. A trace
 * that cannot be written is swallowed: tracing is never worth failing a session
 * for, same as in the Codex mock.
 */
function appendTrace(entry: TraceEntry): void {
  const file = process.env[MOCK_TRACE_ENV_VAR];
  if (file === undefined) return;
  try {
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {}
}

function traceOptions(options: Options | undefined): void {
  if (options === undefined) return;
  appendTrace({
    kind: "session",
    permissionMode: options.permissionMode,
    plugins: options.plugins,
    skills: options.skills,
    mcpServers: Object.keys(options.mcpServers ?? {}),
  });
}

function buildPermissionState(options: Options | undefined): PermissionState {
  const mode = options?.permissionMode ?? MOCK_DEFAULT_MODE;
  const isBypassAvailable =
    mode === MOCK_BYPASS_MODE ||
    options?.allowDangerouslySkipPermissions === true;
  return { mode, isBypassAvailable };
}

function collectPreToolUseHooks(options: Options | undefined): HookCallback[] {
  const matchers = options?.hooks?.[MOCK_PRE_TOOL_USE_EVENT] ?? [];
  return matchers.flatMap((matcher) => matcher.hooks);
}

export function query(params: MockQueryParamsWithScript): Query {
  const opts = params.options;
  traceOptions(opts);
  return buildQuery({
    prompt: params.prompt,
    scriptPath: resolveScriptPath(params.scriptPath),
    signal: opts?.abortController?.signal,
    canUseTool: opts?.canUseTool,
    preToolUseHooks: collectPreToolUseHooks(opts),
    permissions: buildPermissionState(opts),
    mcpServers: opts?.mcpServers,
  });
}

export type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
