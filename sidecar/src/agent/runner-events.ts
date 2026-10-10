import type { ACTIVITY_KINDS } from "../constants/agent.js";

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface RunnerAssistantText {
  type: "assistant_text";
  text: string;
}

export interface RunnerAssistantTextDelta {
  type: "assistant_text_delta";
  text: string;
}

export interface RunnerToolUse {
  type: "tool_use";
  callId: string;
  toolName: string;
  args: unknown;
}

export interface RunnerToolResult {
  type: "tool_result";
  callId: string;
  result: unknown;
  isError: boolean;
  // The call was cut short by an interrupted turn, not failed by the tool.
  isStopped?: boolean;
}

export interface RunnerDone {
  type: "done";
}

export interface RunnerError {
  type: "error";
  message: string;
  isRetryable?: boolean;
}

/**
 * The provider is working without anything to show yet: thinking, composing a
 * tool call, running a tool, compacting, retrying. It keeps the turn alive and
 * tells the user what is going on, and is never persisted.
 */
export interface RunnerActivity {
  type: "activity";
  kind: ActivityKind;
  detail?: string;
}

export type RunnerEvent =
  | RunnerAssistantText
  | RunnerAssistantTextDelta
  | RunnerToolUse
  | RunnerToolResult
  | RunnerDone
  | RunnerError
  | RunnerActivity;
