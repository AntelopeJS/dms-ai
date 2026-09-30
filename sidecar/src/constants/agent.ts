// Idle timeout: the turn is aborted only after this long with no activity from
// the provider, not as a cap on total turn duration (see armTurnTimeout).
export const TURN_IDLE_TIMEOUT_MS = 5 * 60_000;

/** Stands for a duration in words inside the turn-ending reasons below. */
export const DURATION_TOKEN = "{{duration}}";

/** Why a turn ended: the agent reported no activity for the whole idle window. */
export const TURN_IDLE_TIMEOUT_MESSAGE = `The agent reported no activity for ${DURATION_TOKEN}, so the run was stopped.`;

/** Why a turn ended: one tool call was still running when the tool cap ran out. */
export const TURN_TOOL_CAP_MESSAGE = `A tool was still running after ${DURATION_TOKEN}, so the run was stopped.`;

/** Why a turn ended: its provider stream closed before the turn finished. */
export const TURN_STREAM_ENDED_MESSAGE =
  "The agent stopped before finishing its answer: its process ended unexpectedly.";

/** Why a turn ended: its session was torn down while the turn was running. */
export const TURN_SESSION_CLOSED_MESSAGE =
  "The run was stopped because the assistant session was closed (sidecar restart, provider switch or deleted conversation).";

/**
 * What a running turn is busy with, carried by `activity` runner events: the
 * model thinking, streaming its answer, composing a tool call, a tool running,
 * the conversation being compacted, or the provider retrying a failed request.
 */
export const ACTIVITY_KINDS = [
  "thinking",
  "responding",
  "writing",
  "tool",
  "compacting",
  "retrying",
] as const;

// Grace window after a graceful interrupt before we hard-abort the turn, so
// Stop can never silently hang if the provider ignores the interrupt.
export const INTERRUPT_FALLBACK_MS = 4_000;

export const SYSTEM_PROMPT_PLACEHOLDER_UNKNOWN = "unknown";
export const SYSTEM_PROMPT_MODULES_NONE = "none";
export const SYSTEM_PROMPT_MODULES_SEPARATOR = ", ";
export const SYSTEM_PROMPT_TOKEN_NAME = "{{name}}";
export const SYSTEM_PROMPT_TOKEN_HOST_ROOT = "{{hostProjectRoot}}";
export const SYSTEM_PROMPT_TOKEN_MODULES = "{{antelopeModules}}";

// Prepended to every user turn with the live session state read at turn start:
// the page the host is displaying and the active generation mode. This — not any
// value baked into the system prompt — is the authoritative signal for both, so a
// user navigation or a mode flip is reflected on the very next turn. The mode
// descriptions themselves live statically in the system prompt.
export const HOST_CONTEXT_OPEN = "<host-context>";
export const HOST_CONTEXT_CLOSE = "</host-context>";
export const HOST_CONTEXT_PAGE_LABEL = "page: ";
export const HOST_CONTEXT_FILE_LABEL = "file: ";
export const HOST_CONTEXT_TITLE_LABEL = "title: ";
export const HOST_CONTEXT_MODE_LABEL = "mode: ";
