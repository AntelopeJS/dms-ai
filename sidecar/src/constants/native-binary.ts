export const PLATFORM_LINUX = "linux";
export const PLATFORM_WINDOWS = "win32";

/**
 * The Claude Code CLI the sidecar runs is the one the `@anthropic-ai/claude-code`
 * dependency ships, as the native package of its optional dependencies. The
 * Agent SDK bundles a CLI of its own too (`@anthropic-ai/claude-agent-sdk-*`)
 * and would run that when not pointed elsewhere.
 */
export const CLAUDE_CODE_PACKAGE = "@anthropic-ai/claude-code";
export const CLAUDE_CODE_NATIVE_PREFIX = "@anthropic-ai/claude-code-";
export const NATIVE_MUSL_SUFFIX = "-musl";
export const CLAUDE_BINARY_SUBPATH = "/claude";
export const CLAUDE_WINDOWS_BINARY_SUBPATH = "/claude.exe";
