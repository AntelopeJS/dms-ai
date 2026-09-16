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
}

export interface RunnerDone {
  type: "done";
}

export interface RunnerError {
  type: "error";
  message: string;
}

export type RunnerEvent =
  | RunnerAssistantText
  | RunnerAssistantTextDelta
  | RunnerToolUse
  | RunnerToolResult
  | RunnerDone
  | RunnerError;
