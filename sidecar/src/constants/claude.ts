import type {
  SettingSource,
  TerminalReason,
} from "@anthropic-ai/claude-agent-sdk";
import type { ActivityKind } from "../agent/runner-events.js";

// The agent SDK the provider drives. Resolved by specifier rather than imported
// statically wherever absence has to stay survivable (binary resolution,
// availability), in the same spirit as the Codex extension lookup.
export const REAL_SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";

// The mock SDK the tests drive instead of the real one. The specifier is
// resolved relative to the module that imports it, so it tracks
// providers/claude/sdk-loader.ts — not this file.
export const MOCK_CLAUDE_FLAG_ENV = "MOCK_CLAUDE";
export const MOCK_CLAUDE_FLAG_ENABLED = "1";
export const MOCK_CLAUDE_SDK_RELATIVE =
  "../../../tests/fixtures/mock-claude/index.js";

export const SYSTEM_PROMPT_PRESET_TYPE = "preset" as const;
export const SYSTEM_PROMPT_PRESET_NAME = "claude_code" as const;
export const SDK_SETTING_SOURCES_ISOLATED: SettingSource[] = [];
export const SDK_INCLUDE_PARTIAL_MESSAGES = true;

/** The hook event the CLI raises before any permission check of a tool call. */
export const PRE_TOOL_USE_HOOK_EVENT = "PreToolUse" as const;

// Generated skill plugin wrappers live under the sidecar state dir, never the
// repo. The loader passes these as `plugins:[{type:'local'}]` alongside an
// explicit `plugin:skill` allowlist — NEVER `skills:'all'` (Task 1 finding: it
// pulls every built-in/global machine skill into context).
export const SKILL_PLUGIN_WRAPPER_DIR = "skill-plugins";

/** Partial-message events that reveal what the model is doing. */
export const CLAUDE_STREAM_EVENT_TYPES = {
  MESSAGE_START: "message_start",
  CONTENT_BLOCK_START: "content_block_start",
  CONTENT_BLOCK_DELTA: "content_block_delta",
} as const;

/** The text delta, the one partial event that reaches the chat as text. */
export const CLAUDE_TEXT_DELTA_TYPE = "text_delta";

/** What the model is doing when it opens a content block of a given type. */
export const CLAUDE_BLOCK_ACTIVITY: Record<string, ActivityKind> = {
  thinking: "thinking",
  redacted_thinking: "thinking",
  tool_use: "writing",
  server_tool_use: "writing",
  mcp_tool_use: "writing",
};

/** What the model is doing while it streams a delta of a given type. */
export const CLAUDE_DELTA_ACTIVITY: Record<string, ActivityKind> = {
  thinking_delta: "thinking",
  signature_delta: "thinking",
  input_json_delta: "writing",
};

/** System messages that report provider activity. */
export const CLAUDE_SYSTEM_SUBTYPES = {
  STATUS: "status",
  API_RETRY: "api_retry",
} as const;

/** What the provider is doing for a given `status` system message. */
export const CLAUDE_STATUS_ACTIVITY: Record<string, ActivityKind> = {
  compacting: "compacting",
  requesting: "thinking",
};

export const CLAUDE_RETRY_DETAIL_TOKENS = {
  ATTEMPT: "{{attempt}}",
  MAX: "{{max}}",
} as const;

/** Detail of a retried request, filled from an `api_retry` system message. */
export const CLAUDE_RETRY_DETAIL_TEMPLATE = `attempt ${CLAUDE_RETRY_DETAIL_TOKENS.ATTEMPT} of ${CLAUDE_RETRY_DETAIL_TOKENS.MAX}`;

export const CLAUDE_RESULT_SUCCESS_SUBTYPE = "success";

/**
 * Terminal reasons of a turn the user stopped. The SDK reports them as an
 * `error_during_execution` result, yet nothing failed: Stop was pressed.
 */
export const CLAUDE_STOPPED_TERMINAL_REASONS: readonly TerminalReason[] = [
  "aborted_streaming",
  "aborted_tools",
];

/** Terminal reasons that sending the same request again cannot get past. */
export const CLAUDE_UNRETRYABLE_TERMINAL_REASONS: readonly TerminalReason[] = [
  "prompt_too_long",
];

const CLAUDE_USAGE_LIMIT_MESSAGE =
  "The model's usage limit has been reached. Try again once it resets.";

/** Readable reasons for the terminal reasons a user can act on. */
export const CLAUDE_TERMINAL_REASON_MESSAGES: Partial<
  Record<TerminalReason, string>
> = {
  prompt_too_long:
    "The conversation no longer fits in the model's context (a large attachment or a long history). Start a new conversation, or attach a smaller file or only the part that matters.",
  blocking_limit: CLAUDE_USAGE_LIMIT_MESSAGE,
  rapid_refill_breaker: CLAUDE_USAGE_LIMIT_MESSAGE,
  max_turns: "The agent reached its maximum number of steps for one request.",
};

/** Diagnostic lines the CLI adds to `errors`, never meant for a user. */
export const CLAUDE_DIAGNOSTIC_ERROR_PREFIX = "[ede_diagnostic]";

export const CLAUDE_TURN_FAILED_MESSAGE =
  "The agent failed to complete the request.";
