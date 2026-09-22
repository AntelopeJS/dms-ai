// Idle timeout: the turn is aborted only after this long with no activity from
// the provider, not as a cap on total turn duration (see armTurnTimeout).
export const TURN_IDLE_TIMEOUT_MS = 5 * 60_000;
export const TURN_IDLE_TIMEOUT_MESSAGE =
  "AI run timed out after 5 minutes of inactivity";

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
