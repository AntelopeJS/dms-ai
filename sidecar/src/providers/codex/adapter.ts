import { z } from "zod";
import type { RunnerEvent } from "../../agent/runner-events.js";
import {
  CODEX_ACTIVITY_BY_METHOD,
  CODEX_TURN_FAILED_MESSAGE,
} from "../../constants/codex.js";
import { MCP_TOOL_NAME_PREFIX } from "../../constants/mcp.js";
import {
  BASH_COMMAND_ARG,
  EDIT_FILE_PATH_ARG,
  TOOL_LEXICON,
} from "../../constants/tool-lexicon.js";
import { type JsonValue, JsonValueSchema } from "../../protocol/json.js";
import type { CodexNotification } from "./client.js";

const CALL_ID_INDEX_SEPARATOR = ":";
const FAILED_ITEM_STATUSES = ["failed", "declined"];
const INTERRUPTED_RESULT = "interrupted";

const TODO_STATUS_BY_PLAN_STATUS = new Map<string, string>([
  ["pending", "pending"],
  ["inProgress", "in_progress"],
  ["completed", "completed"],
]);

const commandExecutionItemSchema = z.object({
  type: z.literal("commandExecution"),
  id: z.string(),
  command: z.string(),
  status: z.string(),
  aggregatedOutput: z.string().nullish(),
  exitCode: z.number().nullish(),
});

const fileChangeItemSchema = z.object({
  type: z.literal("fileChange"),
  id: z.string(),
  changes: z.array(
    z.object({
      path: z.string(),
      kind: z.object({ type: z.string() }),
      diff: z.string(),
    }),
  ),
  status: z.string(),
});

const mcpToolCallItemSchema = z.object({
  type: z.literal("mcpToolCall"),
  id: z.string(),
  tool: z.string(),
  status: z.string(),
  arguments: JsonValueSchema.optional(),
  result: JsonValueSchema.optional(),
  error: JsonValueSchema.optional(),
});

const agentMessageItemSchema = z.object({
  type: z.literal("agentMessage"),
  id: z.string(),
  text: z.string(),
});

const startedParamsSchema = z.object({
  item: z.discriminatedUnion("type", [
    commandExecutionItemSchema,
    fileChangeItemSchema,
    mcpToolCallItemSchema,
  ]),
});

const completedParamsSchema = z.object({
  item: z.discriminatedUnion("type", [
    commandExecutionItemSchema,
    fileChangeItemSchema,
    mcpToolCallItemSchema,
    agentMessageItemSchema,
  ]),
});

const planUpdatedParamsSchema = z.object({
  plan: z.array(z.object({ step: z.string(), status: z.string() })).optional(),
});

const agentMessageDeltaParamsSchema = z.object({
  delta: z.string().optional(),
});

const turnCompletedParamsSchema = z.object({
  turn: z
    .object({
      status: z.string().optional(),
      error: z.object({ message: z.string() }).nullish(),
    })
    .optional(),
});

type CommandExecutionItem = z.infer<typeof commandExecutionItemSchema>;
type FileChangeItem = z.infer<typeof fileChangeItemSchema>;
type McpToolCallItem = z.infer<typeof mcpToolCallItemSchema>;
type AgentMessageItem = z.infer<typeof agentMessageItemSchema>;
type StartedItem = z.infer<typeof startedParamsSchema>["item"];
type CompletedItem = z.infer<typeof completedParamsSchema>["item"];

/** One file of a pending Codex patch, as its approval card shows it. */
export interface CodexFileChange {
  path: string;
  kind: string;
  diff: string;
}

export interface CodexAdapter {
  /** Runner events produced by one app-server notification. */
  handle(notification: CodexNotification): RunnerEvent[];
  /**
   * Paths a pending file change touches. A fileChange approval request carries
   * only an itemId, while the item/started that precedes it carries the paths,
   * so the permission prompt reads them from here.
   */
  getChangedPaths(itemId: string): string[];
  /** The files of a pending patch with their diffs, for the approval card. */
  getChanges(itemId: string): CodexFileChange[];
}

function toolUse(
  callId: string,
  toolName: string,
  args: JsonValue,
): RunnerEvent {
  return { type: "tool_use", callId, toolName, args };
}

function toolResult(
  callId: string,
  result: JsonValue | undefined,
  isError: boolean,
): RunnerEvent {
  return { type: "tool_result", callId, result, isError };
}

function isFailure(status: string): boolean {
  return FAILED_ITEM_STATUSES.includes(status);
}

function changeCallId(itemId: string, index: number): string {
  return `${itemId}${CALL_ID_INDEX_SEPARATOR}${index}`;
}

/**
 * The plan turned into one synthetic TodoWrite call. `seq` only has to be
 * unique within the conversation, so the count of open calls serves. The
 * tool_use and its result are emitted back to back: a synthetic tool_use with
 * no result would suspend the inactivity timer for good.
 */
function planUpdatedEvents(
  params: z.infer<typeof planUpdatedParamsSchema>,
  seq: number,
): RunnerEvent[] {
  const plan = params.plan ?? [];
  const todos = plan.map((step) => ({
    content: step.step,
    activeForm: step.step,
    status: TODO_STATUS_BY_PLAN_STATUS.get(step.status) ?? step.status,
  }));
  const callId = `${TOOL_LEXICON.TODO_WRITE}${CALL_ID_INDEX_SEPARATOR}${seq}`;
  return [
    toolUse(callId, TOOL_LEXICON.TODO_WRITE, { todos }),
    toolResult(callId, null, false),
  ];
}

function activityEvents(method: string): RunnerEvent[] {
  const kind = CODEX_ACTIVITY_BY_METHOD.get(method);
  if (kind === undefined) return [];
  return [{ type: "activity", kind }];
}

function agentMessageDeltaEvents(
  params: z.infer<typeof agentMessageDeltaParamsSchema>,
): RunnerEvent[] {
  const delta = params.delta ?? "";
  if (delta === "") return [];
  return [{ type: "assistant_text_delta", text: delta }];
}

function completeAgentMessage(item: AgentMessageItem): RunnerEvent[] {
  if (item.text === "") return [];
  return [{ type: "assistant_text", text: item.text }];
}

/** What a notification yields without touching the call ledger. */
function statelessEvents(notification: CodexNotification): RunnerEvent[] {
  if (notification.method !== "item/agentMessage/delta") {
    return activityEvents(notification.method);
  }
  const parsed = agentMessageDeltaParamsSchema.safeParse(notification.params);
  return parsed.success ? agentMessageDeltaEvents(parsed.data) : [];
}

/**
 * Pairing ledger for the tool calls the adapter synthesizes. Insertion-ordered
 * and the sole source of truth: every emitted tool_use is closed from here, so
 * a tool_result can never go missing and leave the session's outstanding-tool
 * counter stuck.
 */
function createCallTracker() {
  const openCallIds = new Set<string>();

  function open(
    callId: string,
    toolName: string,
    args: JsonValue,
  ): RunnerEvent {
    openCallIds.add(callId);
    return toolUse(callId, toolName, args);
  }

  function close(
    callId: string,
    result: JsonValue | undefined,
    isError: boolean,
  ): RunnerEvent[] {
    if (!openCallIds.delete(callId)) return [];
    return [toolResult(callId, result, isError)];
  }

  /** Closes an item's own call plus the per-index ones a patch fans out into. */
  function closeMatching(
    itemId: string,
    result: JsonValue | undefined,
    isError: boolean,
  ): RunnerEvent[] {
    const prefix = `${itemId}${CALL_ID_INDEX_SEPARATOR}`;
    return [...openCallIds]
      .filter((callId) => callId === itemId || callId.startsWith(prefix))
      .flatMap((callId) => close(callId, result, isError));
  }

  return { openCallIds, open, close, closeMatching };
}

export function createCodexAdapter(): CodexAdapter {
  const { openCallIds, open, close, closeMatching } = createCallTracker();
  const changesByItemId = new Map<string, CodexFileChange[]>();

  function startCommand(item: CommandExecutionItem): RunnerEvent[] {
    return [
      open(item.id, TOOL_LEXICON.BASH, {
        [BASH_COMMAND_ARG]: item.command,
      }),
    ];
  }

  /**
   * Opens one tool_use per changed file: that is what the edit tracker reads to
   * drive the change animation, and a patch commonly touches several files.
   */
  function startFileChange(item: FileChangeItem): RunnerEvent[] {
    changesByItemId.set(
      item.id,
      item.changes.map((change) => ({
        path: change.path,
        kind: change.kind.type,
        diff: change.diff,
      })),
    );
    return item.changes.map((change, index) =>
      open(changeCallId(item.id, index), TOOL_LEXICON.EDIT, {
        [EDIT_FILE_PATH_ARG]: change.path,
      }),
    );
  }

  function startMcpToolCall(item: McpToolCallItem): RunnerEvent[] {
    return [
      open(
        item.id,
        `${MCP_TOOL_NAME_PREFIX}${item.tool}`,
        item.arguments ?? null,
      ),
    ];
  }

  function completeCommand(item: CommandExecutionItem): RunnerEvent[] {
    return close(
      item.id,
      { output: item.aggregatedOutput, exitCode: item.exitCode },
      isFailure(item.status),
    );
  }

  /**
   * Closes the per-file calls, then anything opened at start but missing from
   * the completion payload, or its call id would stay outstanding forever.
   */
  function completeFileChange(item: FileChangeItem): RunnerEvent[] {
    const failed = isFailure(item.status);
    const paired = item.changes.flatMap((change, index) =>
      close(changeCallId(item.id, index), { diff: change.diff }, failed),
    );
    return [...paired, ...closeMatching(item.id, null, failed)];
  }

  function completeMcpToolCall(item: McpToolCallItem): RunnerEvent[] {
    const failed = item.error !== null || isFailure(item.status);
    return close(item.id, item.error ?? item.result, failed);
  }

  /**
   * Runs the handler for the item type. userMessage, reasoning and the rest
   * also emit started/completed pairs; they are not tools and must never reach
   * the outstanding-tool counter, so unknown types yield nothing.
   */
  function startItem(item: StartedItem): RunnerEvent[] {
    switch (item.type) {
      case "commandExecution":
        return startCommand(item);
      case "fileChange":
        return startFileChange(item);
      case "mcpToolCall":
        return startMcpToolCall(item);
    }
  }

  function completeItem(item: CompletedItem): RunnerEvent[] {
    switch (item.type) {
      case "commandExecution":
        return completeCommand(item);
      case "fileChange":
        return completeFileChange(item);
      case "mcpToolCall":
        return completeMcpToolCall(item);
      case "agentMessage":
        return completeAgentMessage(item);
    }
  }

  /**
   * Closes every call still open as interrupted, since an interruption leaves
   * items in flight with no item/completed of their own. `done` still follows
   * a failure's error: the neutral session ends a turn on `done` alone, so an
   * error on its own would hang the turn forever.
   */
  function handleTurnCompleted(
    params: z.infer<typeof turnCompletedParamsSchema>,
  ): RunnerEvent[] {
    const { turn } = params;
    const status = turn?.status ?? "completed";
    const orphans = [...openCallIds]
      .flatMap((callId) => close(callId, INTERRUPTED_RESULT, true))
      .map((event) => ({ ...event, isStopped: true }));
    if (status === "failed") {
      const message = turn?.error?.message ?? CODEX_TURN_FAILED_MESSAGE;
      return [...orphans, { type: "error", message }, { type: "done" }];
    }
    return [...orphans, { type: "done" }];
  }

  return {
    getChangedPaths: (itemId) =>
      (changesByItemId.get(itemId) ?? []).map((change) => change.path),
    getChanges: (itemId) => changesByItemId.get(itemId) ?? [],
    handle(notification) {
      switch (notification.method) {
        case "item/started": {
          const parsed = startedParamsSchema.safeParse(notification.params);
          return parsed.success ? startItem(parsed.data.item) : [];
        }
        case "item/completed": {
          const parsed = completedParamsSchema.safeParse(notification.params);
          return parsed.success ? completeItem(parsed.data.item) : [];
        }
        case "turn/plan/updated": {
          const parsed = planUpdatedParamsSchema.safeParse(notification.params);
          return parsed.success
            ? planUpdatedEvents(parsed.data, openCallIds.size)
            : [];
        }
        case "turn/completed":
          return handleTurnCompleted(
            turnCompletedParamsSchema.safeParse(notification.params).data ?? {},
          );
        default:
          return statelessEvents(notification);
      }
    },
  };
}
