import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  HookCallback,
  McpServerConfig,
  Options,
  PermissionMode,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  MOCK_ABORT_REASON,
  MOCK_DEFAULT_SCRIPT_RELATIVE,
  MOCK_INTERRUPTED_RESULT,
  MOCK_PRE_TOOL_USE_EVENT,
  MOCK_REFUSAL_SCRIPT_RELATIVE,
  MOCK_REFUSED_MODEL_ENV_VAR,
  MOCK_SCRIPT_ENV_VAR,
  MOCK_STREAM_DELAY_MS,
} from "./constants.js";
import {
  buildPermissionContext,
  initialPermissions,
  type ModelState,
  type PermissionInputs,
  type PermissionState,
  shouldEmitMessage,
  switchModel,
  switchPermissionMode,
  withLiveInit,
} from "./permissions.js";
import type { LoadedSdk } from "../../../src/providers/claude/sdk-loader.js";
import { traceOptions } from "./trace.js";

const here = dirname(fileURLToPath(import.meta.url));

export interface MockQueryParams {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}

function resolveScriptPath(): string {
  const fromEnv = process.env[MOCK_SCRIPT_ENV_VAR];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return resolve(here, MOCK_DEFAULT_SCRIPT_RELATIVE);
}

const ScriptSchema = z.array(z.custom<SDKMessage>());

async function loadScript(path: string): Promise<SDKMessage[]> {
  const raw = await readFile(path, "utf8");
  return ScriptSchema.parse(JSON.parse(raw));
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

interface BuildMockQueryArgs extends PermissionInputs {
  modelState: ModelState;
  prompt: string | AsyncIterable<SDKUserMessage>;
  scriptPath: string;
  mcpServers?: Record<string, McpServerConfig>;
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

async function entriesFor(
  entries: SDKMessage[],
  modelState: ModelState,
): Promise<SDKMessage[]> {
  const refused = process.env[MOCK_REFUSED_MODEL_ENV_VAR];
  if (refused === undefined || modelState.model !== refused) return entries;
  return loadScript(resolve(here, MOCK_REFUSAL_SCRIPT_RELATIVE));
}

async function* replayOnce(
  scripted: SDKMessage[],
  args: BuildMockQueryArgs,
  interrupted: InterruptFlag,
): AsyncGenerator<SDKMessage, void> {
  const entries = await entriesFor(scripted, args.modelState);
  const permCtx = buildPermissionContext(args, entries);
  for (const entry of entries) {
    await delay(MOCK_STREAM_DELAY_MS, args.signal);
    if (interrupted.requested) {
      interrupted.requested = false;
      yield buildInterruptedResult();
      return;
    }
    const live = withLiveInit(entry, args.permissions, args.modelState);
    if (!(await shouldEmitMessage(live, permCtx))) continue;
    yield live;
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

function buildControlSurface(
  interrupted: InterruptFlag,
  permissions: PermissionState,
  modelState: ModelState,
): Omit<Query, keyof AsyncGenerator<SDKMessage, void>> {
  return {
    interrupt: async () => {
      interrupted.requested = true;
      return undefined;
    },
    setPermissionMode: (mode: PermissionMode) =>
      switchPermissionMode(permissions, modelState, mode),
    setModel: async (model?: string) =>
      switchModel(permissions, modelState, model),
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
    readMcpResource: unsupported("readMcpResource"),
    reinitialize: unsupported("reinitialize"),
    reloadOutputStyles: unsupported("reloadOutputStyles"),
    reloadSkills: unsupported("reloadSkills"),
    setMcpPermissionModeOverride: unsupported("setMcpPermissionModeOverride"),
    updateSettings: unsupported("updateSettings"),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: unsupported(
      "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET",
    ),
    close: unsupported("close"),
  };
}

function buildQuery(args: BuildMockQueryArgs): Query {
  const interrupted: InterruptFlag = { requested: false };
  const stream = createMessageStream(args, interrupted);
  const control = buildControlSurface(
    interrupted,
    args.permissions,
    args.modelState,
  );
  return Object.assign(stream, control);
}

function collectPreToolUseHooks(options: Options | undefined): HookCallback[] {
  const matchers = options?.hooks?.[MOCK_PRE_TOOL_USE_EVENT] ?? [];
  return matchers.flatMap((matcher) => matcher.hooks);
}

/** The SDK's `query`, replaying a script instead of calling the API. */
export const query: LoadedSdk["query"] = (params): Query => {
  const opts = params.options;
  traceOptions(opts);
  return buildQuery({
    modelState: { model: opts?.model },
    prompt: params.prompt,
    scriptPath: resolveScriptPath(),
    signal: opts?.abortController?.signal,
    canUseTool: opts?.canUseTool,
    preToolUseHooks: collectPreToolUseHooks(opts),
    permissions: initialPermissions(opts),
    mcpServers: opts?.mcpServers,
  });
};

export type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
