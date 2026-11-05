import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderSessionContext } from "../../agent/provider.js";
import {
  SDK_INCLUDE_PARTIAL_MESSAGES,
  SDK_SETTING_SOURCES_ISOLATED,
} from "../../constants/claude.js";
import {
  ANALYST_ALLOWED_TOOL_NAMES,
  MCP_SERVER_KEY,
} from "../../constants/mcp.js";
import { SDK_PERMISSION_BEHAVIOR } from "../../constants/permissions.js";
import { ANALYST_SYSTEM_PROMPT } from "../../prompts/analyst.js";
import { buildClaudeEnv, resolveModelOptions } from "./config.js";
import type { SessionOptions, SessionOptionsBuilder } from "./provider.js";
import { resolveClaudeBinary } from "./resolve-binary.js";

const ANALYST_DENIAL = "Analyst can only read data through its own tools.";

function analystCanUseTool(ctx: ProviderSessionContext): CanUseTool {
  return (toolName, input, options) => {
    if (!ANALYST_ALLOWED_TOOL_NAMES.has(toolName)) {
      ctx.onToolDecision?.({
        callId: options.toolUseID,
        toolName,
        allowedBy: "blocked",
      });
      return Promise.resolve({
        behavior: SDK_PERMISSION_BEHAVIOR.DENY,
        message: ANALYST_DENIAL,
      });
    }
    ctx.onToolAnnounced?.(options.toolUseID, toolName, input);
    ctx.onToolDecision?.({
      callId: options.toolUseID,
      toolName,
      allowedBy: "read_auto",
    });
    return Promise.resolve({
      behavior: SDK_PERMISSION_BEHAVIOR.ALLOW,
      updatedInput: input,
    });
  };
}

/**
 * An Analyst session: its own system prompt, no built-in tool at all (no
 * files, shell, web, skills or subagents), no MCP server but its own, and no
 * settings, CLAUDE.md or plugin read from disk.
 */
export const buildAnalystSessionOptions: SessionOptionsBuilder = (
  _config,
  ctx,
  _live,
  abortController,
) => {
  const options: SessionOptions = {
    systemPrompt: ANALYST_SYSTEM_PROMPT,
    tools: [],
    strictMcpConfig: true,
    settingSources: SDK_SETTING_SOURCES_ISOLATED,
    includePartialMessages: SDK_INCLUDE_PARTIAL_MESSAGES,
    permissionMode: "default",
    canUseTool: analystCanUseTool(ctx),
    mcpServers:
      ctx.mcpServer === undefined ? {} : { [MCP_SERVER_KEY]: ctx.mcpServer },
    ...resolveModelOptions(ctx.settings),
    abortController,
    env: buildClaudeEnv(process.env, ctx.hostProjectRoot),
  };
  const claudeBinary = resolveClaudeBinary();
  return Promise.resolve(
    claudeBinary === undefined
      ? options
      : { ...options, pathToClaudeCodeExecutable: claudeBinary },
  );
};
