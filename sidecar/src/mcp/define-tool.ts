import type { ZodType } from "zod";

interface McpToolTextContent {
  type: "text";
  text: string;
}

export type McpToolResult = {
  content: McpToolTextContent[];
  isError?: boolean;
};

/** The zod field schemas of one tool's input, keyed by argument name. */
export type McpToolInputSchema = Record<string, ZodType>;

/**
 * Argument shape a handler receives, mirroring the Claude SDK's own inference so
 * that moving a tool to a neutral definition changes no handler typing: an
 * optional zod field stays present-but-undefined rather than becoming optional.
 */
export type McpToolArgs<Schema extends McpToolInputSchema> = {
  [K in keyof Schema]: Schema[K] extends { _output: infer Output }
    ? Output
    : never;
} & {};

export type McpToolHandler<Schema extends McpToolInputSchema> = (
  args: McpToolArgs<Schema>,
  extra: unknown,
) => Promise<McpToolResult>;

/**
 * Provider-neutral description of one MCP tool. The same definition feeds the
 * in-process Claude binding and the streamable HTTP binding Codex consumes, so
 * the handlers and zod schemas are written once.
 */
export interface McpToolDefinition<
  Schema extends McpToolInputSchema = McpToolInputSchema,
> {
  name: string;
  description: string;
  schema: Schema;
  handler: McpToolHandler<Schema>;
}

export type AnyMcpToolDefinition = McpToolDefinition<any>;

export function defineTool<Schema extends McpToolInputSchema>(
  name: string,
  description: string,
  schema: Schema,
  handler: McpToolHandler<Schema>,
): McpToolDefinition<Schema> {
  return { name, description, schema, handler };
}
