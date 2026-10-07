import { isMutatingBuilderTool } from "../../agent/tool-kinds.js";
import type { AnyMcpToolDefinition, McpToolResult } from "../define-tool.js";

/** Whether one Builder operation may run, decided before it does. */
export interface BuilderGateDecision {
  isAllowed: boolean;
  // Why not, in words the agent reads.
  message?: string;
  // BuilderDeleteResource: the user chose to keep the table's data.
  keepData?: boolean;
}

/**
 * Asked before every mutating Builder operation. Lives in the handler so both
 * providers share it: deletions (and, by setting, block removals) wait for the
 * user here, whatever the approval mode.
 */
export type BuilderGate = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<BuilderGateDecision>;

function refusal(message: string | undefined): McpToolResult {
  return { content: [{ type: "text", text: message ?? "" }], isError: true };
}

function withGate(
  definition: AnyMcpToolDefinition,
  gate: BuilderGate,
): AnyMcpToolDefinition {
  if (!isMutatingBuilderTool(definition.name)) return definition;
  return {
    ...definition,
    handler: async (args: Record<string, unknown>, extra: unknown) => {
      const decision = await gate(definition.name, args);
      if (!decision.isAllowed) return refusal(decision.message);
      const granted =
        decision.keepData === true ? { ...args, keepData: true } : args;
      return definition.handler(granted, extra);
    },
  };
}

/** Puts every mutating Builder tool behind the gate; read tools stay as is. */
export function gateBuilderTools(
  tools: AnyMcpToolDefinition[],
  gate: BuilderGate,
): AnyMcpToolDefinition[] {
  return tools.map((definition) => withGate(definition, gate));
}
