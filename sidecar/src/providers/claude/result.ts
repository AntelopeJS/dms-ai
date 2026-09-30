import type {
  SDKMessage,
  SDKResultMessage,
  TerminalReason,
} from "@anthropic-ai/claude-agent-sdk";
import type { RunnerError, RunnerEvent } from "../../agent/runner-events.js";
import {
  CLAUDE_DIAGNOSTIC_ERROR_PREFIX,
  CLAUDE_RESULT_SUCCESS_SUBTYPE,
  CLAUDE_STOPPED_TERMINAL_REASONS,
  CLAUDE_TERMINAL_REASON_MESSAGES,
  CLAUDE_TURN_FAILED_MESSAGE,
  CLAUDE_UNRETRYABLE_TERMINAL_REASONS,
} from "../../constants/claude.js";

const LINE_SEPARATOR = "\n";

function endsWith(
  result: SDKResultMessage,
  reasons: readonly TerminalReason[],
): boolean {
  if (result.terminal_reason === undefined) return false;
  return reasons.includes(result.terminal_reason);
}

function wasStopped(result: SDKResultMessage): boolean {
  return endsWith(result, CLAUDE_STOPPED_TERMINAL_REASONS);
}

function isFailure(result: SDKResultMessage): boolean {
  if (wasStopped(result)) return false;
  if (result.is_error) return true;
  return result.subtype !== CLAUDE_RESULT_SUCCESS_SUBTYPE;
}

function firstLine(text: string): string {
  return (text.split(LINE_SEPARATOR)[0] ?? "").trim();
}

function readableErrors(errors: string[] | undefined): string[] {
  return (errors ?? [])
    .filter((entry) => !entry.startsWith(CLAUDE_DIAGNOSTIC_ERROR_PREFIX))
    .map(firstLine)
    .filter((entry) => entry !== "");
}

function knownReasonMessage(result: SDKResultMessage): string | undefined {
  if (result.terminal_reason === undefined) return undefined;
  return CLAUDE_TERMINAL_REASON_MESSAGES[result.terminal_reason];
}

function reportedMessage(result: SDKResultMessage): string | undefined {
  if (result.subtype !== CLAUDE_RESULT_SUCCESS_SUBTYPE) {
    return readableErrors(result.errors)[0];
  }
  const text = result.result?.trim() ?? "";
  return text === "" ? undefined : text;
}

function describeFailure(result: SDKResultMessage): string {
  return (
    knownReasonMessage(result) ??
    reportedMessage(result) ??
    CLAUDE_TURN_FAILED_MESSAGE
  );
}

function failureEvent(result: SDKResultMessage): RunnerError {
  const event: RunnerError = {
    type: "error",
    message: describeFailure(result),
  };
  if (endsWith(result, CLAUDE_UNRETRYABLE_TERMINAL_REASONS)) {
    event.isRetryable = false;
  }
  return event;
}

/**
 * The terminal events of a turn result: `done`, preceded by the reason when the
 * turn failed. A failed turn often has no streamed text at all — an API error,
 * a usage limit, a prompt too long for the context — so without the error the
 * chat would end the run with no answer and no explanation. A turn the user
 * stopped is reported as an error by the SDK, but is not one.
 */
export function resultEvents(message: SDKMessage): RunnerEvent[] {
  if (message.type !== "result") return [];
  if (!isFailure(message)) return [{ type: "done" }];
  return [failureEvent(message), { type: "done" }];
}
