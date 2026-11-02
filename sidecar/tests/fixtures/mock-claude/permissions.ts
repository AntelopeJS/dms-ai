import type {
  CanUseTool,
  HookCallback,
  HookJSONOutput,
  Options,
  PermissionMode,
  PermissionResult,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  MOCK_ACCEPT_EDITS_COMMANDS,
  MOCK_ACCEPT_EDITS_MODE,
  MOCK_ACCEPT_EDITS_TOOLS,
  MOCK_AUTO_MODE,
  MOCK_AUTO_READ_TOOLS,
  MOCK_AUTO_UNAVAILABLE_ERROR,
  MOCK_AUTO_UNSUPPORTED_MODEL_ENV_VAR,
  MOCK_BYPASS_MODE,
  MOCK_BYPASS_UNAVAILABLE_ERROR,
  MOCK_CAN_USE_TOOL_BEHAVIOR_ALLOW,
  MOCK_DEFAULT_MODE,
  MOCK_DEFAULT_MODEL,
  MOCK_HOOK_ASK,
  MOCK_HOOK_DENY,
  MOCK_INIT_SUBTYPE,
  MOCK_PERMISSION_DENIED_SUBTYPE,
  MOCK_PLAN_MODE,
  MOCK_PRE_TOOL_USE_EVENT,
  MOCK_READ_ONLY_COMMANDS,
  MOCK_SHELL_COMMAND_ARG,
  MOCK_SHELL_TOOL,
} from "./constants.js";
import { appendTrace, type DecidingLayer } from "./trace.js";

/**
 * The permission mode of one query, as the CLI keeps it: bypassing stays
 * available for the life of a process launched in `bypassPermissions`.
 */
export interface PermissionState {
  mode: PermissionMode;
  isBypassAvailable: boolean;
}

/** The model one query runs on; `undefined` is the CLI's default. */
export interface ModelState {
  model: string | undefined;
}

export interface PermissionInputs {
  canUseTool?: CanUseTool;
  preToolUseHooks: HookCallback[];
  permissions: PermissionState;
  signal?: AbortSignal;
}

export interface PermissionContext extends PermissionInputs {
  signal: AbortSignal;
  deniedToolIds: Set<string>;
  classifierDenials: ReadonlySet<string>;
  modeDenials: ReadonlySet<string>;
  refusedUnprompted: Set<string>;
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

interface ToolDecision {
  decidedBy: DecidingLayer;
  isAllowed: boolean;
}

type HookVerdict = "deny" | "ask" | "none";

function verdictOf(output: HookJSONOutput): HookVerdict {
  if (!("hookSpecificOutput" in output)) return "none";
  const specific = output.hookSpecificOutput;
  if (specific === undefined || !("permissionDecision" in specific)) {
    return "none";
  }
  if (specific.permissionDecision === MOCK_HOOK_DENY) return "deny";
  return specific.permissionDecision === MOCK_HOOK_ASK ? "ask" : "none";
}

async function hookVerdict(
  block: ToolUseBlock,
  ctx: PermissionContext,
): Promise<HookVerdict> {
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
  let verdict: HookVerdict = "none";
  for (const hook of ctx.preToolUseHooks) {
    const found = verdictOf(
      await hook(input, block.id, { signal: ctx.signal }),
    );
    if (found === "deny") return found;
    if (found === "ask") verdict = found;
  }
  return verdict;
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
  [MOCK_AUTO_MODE]: (block) => MOCK_AUTO_READ_TOOLS.includes(block.name),
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
  const result: PermissionResult | null = await ctx.canUseTool(
    block.name,
    block.input,
    { signal: ctx.signal, toolUseID: block.id, requestId: block.id },
  );
  const isAllowed = result?.behavior === MOCK_CAN_USE_TOOL_BEHAVIOR_ALLOW;
  return { decidedBy: "canUseTool", isAllowed };
}

async function decide(
  block: ToolUseBlock,
  ctx: PermissionContext,
): Promise<ToolDecision> {
  const verdict = await hookVerdict(block, ctx);
  if (verdict === "deny") return { decidedBy: "hook", isAllowed: false };
  if (verdict === "ask") return askCanUseTool(block, ctx);
  if (ctx.modeDenials.has(block.id)) {
    return { decidedBy: "mode", isAllowed: false };
  }
  if (isReadOnlyCommand(block)) {
    return { decidedBy: "readOnly", isAllowed: true };
  }
  if (isApprovedByMode(block, ctx.permissions)) {
    return { decidedBy: "mode", isAllowed: true };
  }
  if (ctx.permissions.mode !== MOCK_AUTO_MODE) return askCanUseTool(block, ctx);
  const isAllowed = !ctx.classifierDenials.has(block.id);
  return { decidedBy: "classifier", isAllowed };
}

async function evaluateBlock(
  block: ToolUseBlock,
  ctx: PermissionContext,
): Promise<boolean> {
  const decision = await decide(block, ctx);
  appendTrace({ kind: "tool", name: block.name, ...decision });
  if (decision.isAllowed) return true;
  if (decision.decidedBy === "classifier" || decision.decidedBy === "mode") {
    ctx.refusedUnprompted.add(block.id);
    return true;
  }
  ctx.deniedToolIds.add(block.id);
  return false;
}

export async function shouldEmitMessage(
  message: SDKMessage,
  ctx: PermissionContext | null,
): Promise<boolean> {
  if (ctx === null) return true;
  if (
    message.type === "system" &&
    message.subtype === MOCK_PERMISSION_DENIED_SUBTYPE
  ) {
    return ctx.refusedUnprompted.has(message.tool_use_id);
  }
  if (message.type === "user") {
    const id = extractToolResultId(message);
    return id === null || !ctx.deniedToolIds.has(id);
  }
  for (const block of extractToolUseBlocks(message)) {
    if (!(await evaluateBlock(block, ctx))) return false;
  }
  return true;
}

function scriptedDenials(
  entries: readonly SDKMessage[],
  reason: string,
): Set<string> {
  return new Set(
    entries.flatMap((entry) =>
      entry.type === "system" &&
      entry.subtype === MOCK_PERMISSION_DENIED_SUBTYPE &&
      entry.decision_reason_type === reason
        ? [entry.tool_use_id]
        : [],
    ),
  );
}

export function buildPermissionContext(
  inputs: PermissionInputs,
  entries: readonly SDKMessage[],
): PermissionContext | null {
  if (inputs.canUseTool === undefined && inputs.preToolUseHooks.length === 0) {
    return null;
  }
  return {
    ...inputs,
    signal: inputs.signal ?? new AbortController().signal,
    deniedToolIds: new Set<string>(),
    classifierDenials: scriptedDenials(entries, "classifier"),
    modeDenials: scriptedDenials(entries, "mode"),
    refusedUnprompted: new Set<string>(),
  };
}

function isAutoSupported(model: string | undefined): boolean {
  const unsupported = process.env[MOCK_AUTO_UNSUPPORTED_MODEL_ENV_VAR];
  return (model ?? MOCK_DEFAULT_MODEL) !== unsupported;
}

export function initialPermissions(
  options: Options | undefined,
): PermissionState {
  const requested = options?.permissionMode ?? MOCK_DEFAULT_MODE;
  const isRefused =
    requested === MOCK_AUTO_MODE && !isAutoSupported(options?.model);
  return {
    mode: isRefused ? MOCK_DEFAULT_MODE : requested,
    isBypassAvailable:
      requested === MOCK_BYPASS_MODE ||
      options?.allowDangerouslySkipPermissions === true,
  };
}

export function switchPermissionMode(
  permissions: PermissionState,
  modelState: ModelState,
  mode: PermissionMode,
): Promise<void> {
  if (mode === MOCK_BYPASS_MODE && !permissions.isBypassAvailable) {
    return Promise.reject(new Error(MOCK_BYPASS_UNAVAILABLE_ERROR));
  }
  if (mode === MOCK_AUTO_MODE && !isAutoSupported(modelState.model)) {
    return Promise.reject(new Error(MOCK_AUTO_UNAVAILABLE_ERROR));
  }
  permissions.mode = mode;
  appendTrace({ kind: "permission_mode", permissionMode: mode });
  return Promise.resolve();
}

/**
 * Moving onto a model without Auto review puts the CLI back in `default`;
 * moving onto one with it does not bring `auto` back.
 */
export function switchModel(
  permissions: PermissionState,
  modelState: ModelState,
  model: string | undefined,
): void {
  modelState.model = model;
  appendTrace({ kind: "model", model: model ?? MOCK_DEFAULT_MODEL });
  if (permissions.mode !== MOCK_AUTO_MODE || isAutoSupported(model)) return;
  permissions.mode = MOCK_DEFAULT_MODE;
  appendTrace({ kind: "permission_mode", permissionMode: MOCK_DEFAULT_MODE });
}

export function withLiveInit(
  entry: SDKMessage,
  permissions: PermissionState,
  modelState: ModelState,
): SDKMessage {
  if (entry.type !== "system" || entry.subtype !== MOCK_INIT_SUBTYPE) {
    return entry;
  }
  return {
    ...entry,
    permissionMode: permissions.mode,
    model: modelState.model ?? MOCK_DEFAULT_MODEL,
  };
}
