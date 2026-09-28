import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RunnerEvent } from "../../agent/runner-events.js";
import {
  CLAUDE_DIAGNOSTIC_ERROR_PREFIX,
  CLAUDE_RESULT_SUCCESS_SUBTYPE,
  CLAUDE_STOPPED_TERMINAL_REASONS,
  CLAUDE_TERMINAL_REASON_MESSAGES,
  CLAUDE_TURN_FAILED_MESSAGE,
} from "../../constants/claude.js";

interface SdkResultPayload {
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  errors?: unknown;
  terminal_reason?: string;
}

const LINE_SEPARATOR = "\n";

function wasStopped(payload: SdkResultPayload): boolean {
  return CLAUDE_STOPPED_TERMINAL_REASONS.includes(
    payload.terminal_reason ?? "",
  );
}

function isFailure(payload: SdkResultPayload): boolean {
  if (wasStopped(payload)) return false;
  if (payload.is_error === true) return true;
  const subtype = payload.subtype ?? CLAUDE_RESULT_SUCCESS_SUBTYPE;
  return subtype !== CLAUDE_RESULT_SUCCESS_SUBTYPE;
}

function firstLine(text: string): string {
  return (text.split(LINE_SEPARATOR)[0] ?? "").trim();
}

function readableErrors(errors: unknown): string[] {
  if (!Array.isArray(errors)) return [];
  return errors
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => !entry.startsWith(CLAUDE_DIAGNOSTIC_ERROR_PREFIX))
    .map(firstLine)
    .filter((entry) => entry !== "");
}

function describeFailure(payload: SdkResultPayload): string {
  const known = CLAUDE_TERMINAL_REASON_MESSAGES[payload.terminal_reason ?? ""];
  if (known !== undefined) return known;
  if (typeof payload.result === "string" && payload.result.trim() !== "") {
    return payload.result.trim();
  }
  return readableErrors(payload.errors)[0] ?? CLAUDE_TURN_FAILED_MESSAGE;
}

/**
 * The terminal events of a turn result: `done`, preceded by the reason when the
 * turn failed. A failed turn often has no streamed text at all — an API error,
 * a usage limit, a prompt too long for the context — so without the error the
 * chat would end the run with no answer and no explanation. A turn the user
 * stopped is reported as an error by the SDK, but is not one.
 */
export function resultEvents(message: SDKMessage): RunnerEvent[] {
  const payload = message as SdkResultPayload;
  if (!isFailure(payload)) return [{ type: "done" }];
  return [
    { type: "error", message: describeFailure(payload) },
    { type: "done" },
  ];
}
