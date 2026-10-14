import { describe, expect, it } from "vitest";
import { CLAUDE_MCP_TOOL_TIMEOUT_ENV_VAR } from "../../src/constants/claude.js";
import {
  MCP_TOOL_TIMEOUT_MS,
  MCP_TOOL_TIMEOUT_SEC,
} from "../../src/constants/mcp.js";
import { QUESTION_TIMEOUT_MS } from "../../src/constants/questions.js";
import { MS_PER_MINUTE } from "../../src/constants/settings.js";
import { buildClaudeEnv } from "../../src/providers/claude/config.js";
import { buildConfigToml } from "../../src/providers/codex/config.js";
import { REQUEST_TIMEOUT_MINUTES } from "../../src/state/settings-types.js";

const INHERITED_TIMEOUT = "60000";

describe("MCP tool timeout", () => {
  it("outlasts every wait on the user", () => {
    expect(MCP_TOOL_TIMEOUT_MS).toBeGreaterThan(QUESTION_TIMEOUT_MS);
    expect(MCP_TOOL_TIMEOUT_MS).toBeGreaterThan(
      Math.max(...REQUEST_TIMEOUT_MINUTES) * MS_PER_MINUTE,
    );
  });

  it("overrides an inherited Claude timeout and keeps the rest of the env", () => {
    const env = buildClaudeEnv({
      PATH: "/usr/bin",
      [CLAUDE_MCP_TOOL_TIMEOUT_ENV_VAR]: INHERITED_TIMEOUT,
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env[CLAUDE_MCP_TOOL_TIMEOUT_ENV_VAR]).toBe(
      String(MCP_TOOL_TIMEOUT_MS),
    );
  });

  it("is set on the Codex MCP server", () => {
    const toml = buildConfigToml({
      mcpUrl: "http://127.0.0.1:4321/mcp",
      hostProjectRoot: "/srv/app",
    });
    const server = toml.split("[projects.")[0] ?? "";
    expect(server).toContain(`tool_timeout_sec = ${MCP_TOOL_TIMEOUT_SEC}`);
  });
});
