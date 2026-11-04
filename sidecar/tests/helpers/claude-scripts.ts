import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolArgs } from "../../src/agent/edit-targets.js";

type UnpromptedRefusal = "classifier" | "mode";

export interface ScriptedCall {
  id: string;
  name: string;
  input: ToolArgs;
  /**
   * The CLI refuses it without a prompt: its `permission_denied` message and an
   * error result follow the call, as CLI 2.1.316 sends them.
   */
  refusedBy?: UnpromptedRefusal;
}

const SESSION_ID = "mock-session-scripted";
const SCRIPT_MODEL = "claude-mock";
const AUTO_REVIEW_DENIAL = "This action was blocked by Auto review.";
const DONE_TEXT = "Done.";

const USAGE = {
  input_tokens: 5,
  output_tokens: 7,
  cache_creation: null,
  cache_creation_input_tokens: null,
  cache_read_input_tokens: null,
  inference_geo: null,
  iterations: null,
  server_tool_use: null,
  service_tier: null,
  speed: null,
};

function envelope() {
  return { uuid: randomUUID(), session_id: SESSION_ID };
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: ToolArgs;
}

interface TextBlock {
  type: "text";
  citations: null;
  text: string;
}

function assistant(
  content: ReadonlyArray<ToolUseBlock | TextBlock>,
  stopReason: string,
) {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    ...envelope(),
    message: {
      id: `msg_${randomUUID()}`,
      type: "message",
      role: "assistant",
      model: SCRIPT_MODEL,
      stop_reason: stopReason,
      stop_sequence: null,
      container: null,
      context_management: null,
      usage: USAGE,
      content,
    },
  };
}

function toolResult(call: ScriptedCall) {
  const isRefused = call.refusedBy !== undefined;
  return {
    type: "user",
    parent_tool_use_id: null,
    ...envelope(),
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: call.id,
          content: isRefused ? AUTO_REVIEW_DENIAL : "ok",
          is_error: isRefused,
        },
      ],
    },
  };
}

function unpromptedDenial(call: ScriptedCall, reason: UnpromptedRefusal) {
  return {
    type: "system",
    subtype: "permission_denied",
    tool_name: call.name,
    tool_use_id: call.id,
    decision_reason_type: reason,
    message: AUTO_REVIEW_DENIAL,
    ...envelope(),
  };
}

function callMessages(call: ScriptedCall) {
  const use = assistant(
    [{ type: "tool_use", id: call.id, name: call.name, input: call.input }],
    "tool_use",
  );
  const denial =
    call.refusedBy === undefined
      ? []
      : [unpromptedDenial(call, call.refusedBy)];
  return [use, ...denial, toolResult(call)];
}

const INIT = {
  type: "system",
  subtype: "init",
  apiKeySource: "user",
  claude_code_version: "0.0.0-mock",
  cwd: "/mock",
  tools: [],
  mcp_servers: [],
  model: SCRIPT_MODEL,
  permissionMode: "default",
  slash_commands: [],
  output_style: "default",
  skills: [],
  plugins: [],
  agents: [],
};

const RESULT = {
  type: "result",
  subtype: "success",
  duration_ms: 10,
  duration_api_ms: 10,
  is_error: false,
  num_turns: 1,
  result: DONE_TEXT,
  stop_reason: "end_turn",
  total_cost_usd: 0,
  usage: USAGE,
  modelUsage: {},
  permission_denials: [],
};

/**
 * Writes a one-turn mock Claude script that makes `calls` in order, then ends
 * the turn, and returns its path.
 */
export async function writeClaudeScript(
  dir: string,
  name: string,
  calls: readonly ScriptedCall[],
): Promise<string> {
  const messages = [
    { ...INIT, ...envelope() },
    ...calls.flatMap(callMessages),
    assistant([{ type: "text", citations: null, text: DONE_TEXT }], "end_turn"),
    { ...RESULT, ...envelope() },
  ];
  const path = join(dir, `${name}.json`);
  await writeFile(path, JSON.stringify(messages));
  return path;
}
