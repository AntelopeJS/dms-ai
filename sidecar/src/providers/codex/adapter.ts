import type { RunnerEvent } from "../../agent/runner-events.js";
import { CODEX_TURN_FAILED_MESSAGE } from "../../constants/codex.js";
import { MCP_TOOL_NAME_PREFIX } from "../../constants/mcp.js";
import {
  BASH_COMMAND_ARG,
  EDIT_FILE_PATH_ARG,
  TOOL_LEXICON,
} from "../../constants/tool-lexicon.js";
import type { CodexNotification } from "./client.js";
import type { v2 } from "./protocol/index.js";

const CALL_ID_INDEX_SEPARATOR = ":";
const FAILED_ITEM_STATUSES = ["failed", "declined"];
const INTERRUPTED_RESULT = "interrupted";

const TODO_STATUS_BY_PLAN_STATUS: Record<string, string> = {
  pending: "pending",
  inProgress: "in_progress",
  completed: "completed",
};

interface ItemEnvelope {
  item?: { type?: string; id?: string } & Record<string, unknown>;
}

interface CommandExecutionItem {
  id: string;
  command: string;
  status: string;
  aggregatedOutput: string | null;
  exitCode: number | null;
}

interface FileChangeItem {
  id: string;
  changes: v2.FileUpdateChange[];
  status: string;
}

interface McpToolCallItem {
  id: string;
  tool: string;
  status: string;
  arguments: unknown;
  result: unknown;
  error: unknown;
}

interface AgentMessageItem {
  id: string;
  text: string;
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
}

function toolUse(callId: string, toolName: string, args: unknown): RunnerEvent {
  return { type: "tool_use", callId, toolName, args };
}

function toolResult(
  callId: string,
  result: unknown,
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

/** The plan turned into one synthetic TodoWrite call. `seq` only has to be
 * unique within the conversation, so the count of open calls serves. */
function planUpdatedEvents(params: unknown, seq: number): RunnerEvent[] {
  const plan = (params as { plan?: v2.TurnPlanStep[] }).plan ?? [];
  const todos = plan.map((step) => ({
    content: step.step,
    activeForm: step.step,
    status: TODO_STATUS_BY_PLAN_STATUS[step.status] ?? step.status,
  }));
  const callId = `${TOOL_LEXICON.TODO_WRITE}${CALL_ID_INDEX_SEPARATOR}${seq}`;
  // Emitted back to back: a synthetic tool_use with no result would suspend
  // the inactivity timer for good.
  return [
    toolUse(callId, TOOL_LEXICON.TODO_WRITE, { todos }),
    toolResult(callId, null, false),
  ];
}

function agentMessageDeltaEvents(params: unknown): RunnerEvent[] {
  const delta = (params as { delta?: string }).delta ?? "";
  if (delta === "") return [];
  return [{ type: "assistant_text_delta", text: delta }];
}

/**
 * Pairing ledger for the tool calls the adapter synthesizes. Insertion-ordered
 * and the sole source of truth: every emitted tool_use is closed from here, so
 * a tool_result can never go missing and leave the session's outstanding-tool
 * counter stuck.
 */
function createCallTracker() {
  const openCallIds = new Set<string>();

  function open(callId: string, toolName: string, args: unknown): RunnerEvent {
    openCallIds.add(callId);
    return toolUse(callId, toolName, args);
  }

  function close(
    callId: string,
    result: unknown,
    isError: boolean,
  ): RunnerEvent[] {
    if (!openCallIds.delete(callId)) return [];
    return [toolResult(callId, result, isError)];
  }

  /** Closes an item's own call plus the per-index ones a patch fans out into. */
  function closeMatching(
    itemId: string,
    result: unknown,
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
  const changedPathsByItemId = new Map<string, string[]>();

  function startCommand(item: CommandExecutionItem): RunnerEvent[] {
    return [
      open(item.id, TOOL_LEXICON.BASH, {
        [BASH_COMMAND_ARG]: item.command,
      }),
    ];
  }

  // One tool_use per changed file: that is what the edit tracker reads to drive
  // the change animation, and a patch commonly touches several files.
  function startFileChange(item: FileChangeItem): RunnerEvent[] {
    changedPathsByItemId.set(
      item.id,
      item.changes.map((change) => change.path),
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

  function completeFileChange(item: FileChangeItem): RunnerEvent[] {
    const failed = isFailure(item.status);
    const paired = item.changes.flatMap((change, index) =>
      close(changeCallId(item.id, index), { diff: change.diff }, failed),
    );
    // Anything opened at start but missing from the completion payload still
    // has to be closed, or its call id stays outstanding forever.
    return [...paired, ...closeMatching(item.id, null, failed)];
  }

  function completeMcpToolCall(item: McpToolCallItem): RunnerEvent[] {
    const failed = item.error !== null || isFailure(item.status);
    return close(item.id, item.error ?? item.result, failed);
  }

  function completeAgentMessage(item: AgentMessageItem): RunnerEvent[] {
    if (item.text === "") return [];
    return [{ type: "assistant_text", text: item.text }];
  }

  const START_HANDLERS: Record<string, (item: never) => RunnerEvent[]> = {
    commandExecution: startCommand as (item: never) => RunnerEvent[],
    fileChange: startFileChange as (item: never) => RunnerEvent[],
    mcpToolCall: startMcpToolCall as (item: never) => RunnerEvent[],
  };

  const COMPLETE_HANDLERS: Record<string, (item: never) => RunnerEvent[]> = {
    commandExecution: completeCommand as (item: never) => RunnerEvent[],
    fileChange: completeFileChange as (item: never) => RunnerEvent[],
    mcpToolCall: completeMcpToolCall as (item: never) => RunnerEvent[],
    agentMessage: completeAgentMessage as (item: never) => RunnerEvent[],
  };

  function applyItemHandler(
    handlers: Record<string, (item: never) => RunnerEvent[]>,
    params: unknown,
  ): RunnerEvent[] {
    const item = (params as ItemEnvelope).item;
    if (item?.type === undefined) return [];
    const handler = handlers[item.type];
    // userMessage, reasoning and the rest also emit started/completed pairs.
    // They are not tools and must never reach the outstanding-tool counter.
    if (handler === undefined) return [];
    return handler(item as never);
  }

  function handleTurnCompleted(params: unknown): RunnerEvent[] {
    const turn = (params as { turn?: v2.Turn }).turn;
    const status = turn?.status ?? "completed";
    // Interruption leaves items in flight with no item/completed of their own,
    // so the adapter closes them itself.
    const orphans = [...openCallIds].flatMap((callId) =>
      close(callId, INTERRUPTED_RESULT, true),
    );
    if (status === "failed") {
      const message = turn?.error?.message ?? CODEX_TURN_FAILED_MESSAGE;
      // `done` still follows the error: the neutral session ends a turn on
      // `done` alone, so an error on its own would hang the turn forever.
      return [...orphans, { type: "error", message }, { type: "done" }];
    }
    return [...orphans, { type: "done" }];
  }

  const HANDLERS: Record<string, (params: unknown) => RunnerEvent[]> = {
    "item/started": (params) => applyItemHandler(START_HANDLERS, params),
    "item/completed": (params) => applyItemHandler(COMPLETE_HANDLERS, params),
    "item/agentMessage/delta": agentMessageDeltaEvents,
    "turn/plan/updated": (params: unknown) =>
      planUpdatedEvents(params, openCallIds.size),
    "turn/completed": handleTurnCompleted,
  };

  return {
    getChangedPaths: (itemId) => changedPathsByItemId.get(itemId) ?? [],
    handle(notification) {
      const handler = HANDLERS[notification.method];
      // Everything else is ignored on purpose, `error` notifications first:
      // Codex emits them while reconnecting and the turn still completes
      // normally, so treating one as terminal would cut the conversation.
      if (handler === undefined) return [];
      return handler(notification.params);
    },
  };
}
