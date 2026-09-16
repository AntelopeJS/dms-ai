import type { SettingSource } from "@anthropic-ai/claude-agent-sdk";

// Idle timeout: the turn is aborted only after this long with no activity from
// the SDK, not as a cap on total turn duration (see armTurnTimeout).
export const SDK_TIMEOUT_MS = 5 * 60_000;
export const SDK_TIMEOUT_MESSAGE =
  "AI run timed out after 5 minutes of inactivity";

// Grace window after a graceful interrupt before we hard-abort the turn, so
// Stop can never silently hang if the SDK ignores the interrupt.
export const INTERRUPT_FALLBACK_MS = 4_000;
export const MOCK_FLAG_ENV = "MOCK_CLAUDE";
export const MOCK_FLAG_ENABLED = "1";
export const REAL_SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";
export const MOCK_SDK_RELATIVE = "../../tests/fixtures/mock-claude/index.js";

export const SYSTEM_PROMPT_PRESET_TYPE = "preset" as const;
export const SYSTEM_PROMPT_PRESET_NAME = "claude_code" as const;
export const SDK_SETTING_SOURCES_ISOLATED: SettingSource[] = [];
// Generated skill plugin wrappers live under the sidecar state dir, never the
// repo. The loader passes these as `plugins:[{type:'local'}]` alongside an
// explicit `plugin:skill` allowlist — NEVER `skills:'all'` (Task 1 finding: it
// pulls every built-in/global machine skill into context).
export const SKILL_PLUGIN_WRAPPER_DIR = "skill-plugins";
export const SDK_INCLUDE_PARTIAL_MESSAGES = true;
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
