import type { SettingSource } from "@anthropic-ai/claude-agent-sdk";

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

// Generated skill plugin wrappers live under the sidecar state dir, never the
// repo. The loader passes these as `plugins:[{type:'local'}]` alongside an
// explicit `plugin:skill` allowlist — NEVER `skills:'all'` (Task 1 finding: it
// pulls every built-in/global machine skill into context).
export const SKILL_PLUGIN_WRAPPER_DIR = "skill-plugins";
