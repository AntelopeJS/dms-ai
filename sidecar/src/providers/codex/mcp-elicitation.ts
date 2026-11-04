import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { ToolDecision } from "../../agent/provider.js";
import { isMutatingBuilderTool } from "../../agent/tool-kinds.js";
import { FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES } from "../../constants/mcp.js";
import { JsonValueSchema } from "../../protocol/json.js";
import { type CodexMcpCall, mcpToolName } from "./adapter.js";

export const CODEX_MCP_ELICITATION_METHOD = "mcpServer/elicitation/request";

const MCP_TOOL_CALL_APPROVAL_KIND = "mcp_tool_call";

/**
 * The consent Codex asks for before it runs an MCP tool: a form with nothing
 * to fill in, tagged as a tool-call approval. Every other elicitation (a form
 * with fields, an OpenAI form, a URL, a user verification) asks the person for
 * input that only they can give.
 */
const toolCallConsentSchema = z.object({
  serverName: z.string(),
  mode: z.literal("form"),
  _meta: z.object({
    codex_approval_kind: z.literal(MCP_TOOL_CALL_APPROVAL_KIND),
    tool_params: JsonValueSchema.optional(),
  }),
  requestedSchema: z.object({ properties: z.object({}).strict() }),
});

/** The fields every elicitation mode carries, parsed where the request arrives. */
export const mcpElicitationParamsSchema = z.object({
  serverName: z.string(),
  mode: z.string(),
  _meta: JsonValueSchema.nullish(),
  requestedSchema: JsonValueSchema.optional(),
});

type McpElicitationParams = z.infer<typeof mcpElicitationParamsSchema>;

type ToolCallConsent = z.infer<typeof toolCallConsentSchema>;

/** What the sidecar answers one elicitation with. */
export type ElicitationVerdict =
  | { action: "accept"; decision: ToolDecision }
  | { action: "decline"; reason: string; decision?: ToolDecision };

/** The call in flight on the consent's server whose arguments it carries. */
function findCall(
  consent: ToolCallConsent,
  pending: readonly CodexMcpCall[],
): CodexMcpCall | undefined {
  const onServer = pending.filter((call) => call.server === consent.serverName);
  const params = consent._meta.tool_params;
  if (params === undefined) return onServer.at(-1);
  return onServer.find((call) => isDeepStrictEqual(call.arguments, params));
}

/**
 * Accepts the consent for dms-ai's own tools, as the Claude path auto-allows
 * them in every mode and scope: deletions and the other always-ask Builder
 * operations still wait for the person at the gate inside the tool. Declines
 * any other server's tool, and any elicitation that asks for user input.
 */
export function decideElicitation(
  params: McpElicitationParams | undefined,
  pending: readonly CodexMcpCall[],
): ElicitationVerdict {
  if (params === undefined) {
    return { action: "decline", reason: "declined a malformed elicitation" };
  }
  const consent = toolCallConsentSchema.safeParse(params);
  if (!consent.success) {
    return {
      action: "decline",
      reason: `declined a ${params.mode} elicitation from MCP server ${params.serverName}: it asks for user input`,
    };
  }
  const call = findCall(consent.data, pending);
  if (call === undefined) {
    return {
      action: "decline",
      reason: `declined a tool call from MCP server ${consent.data.serverName}: no call in flight matches it`,
    };
  }
  const toolName = mcpToolName(call.server, call.tool);
  if (!FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES.has(toolName)) {
    return {
      action: "decline",
      reason: `declined ${toolName}: not a dms-ai tool`,
      decision: { callId: call.id, toolName, allowedBy: "blocked" },
    };
  }
  return {
    action: "accept",
    decision: {
      callId: call.id,
      toolName,
      allowedBy: isMutatingBuilderTool(toolName) ? "builder_auto" : "read_auto",
    },
  };
}
