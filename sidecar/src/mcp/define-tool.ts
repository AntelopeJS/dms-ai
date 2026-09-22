import type { ZodRawShape } from "zod";

export interface McpToolTextContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpToolTextContent[];
  [key: string]: unknown;
}

/**
 * Argument shape a handler receives, mirroring the Claude SDK's own inference so
 * that moving a tool to a neutral definition changes no handler typing: an
 * optional zod field stays present-but-undefined rather than becoming optional.
 */
export type McpToolArgs<Schema extends ZodRawShape> = {
  [K in keyof Schema]: Schema[K] extends { _output: infer Output }
    ? Output
    : never;
} & {};

export type McpToolHandler<Schema extends ZodRawShape> = (
  args: McpToolArgs<Schema>,
  extra: unknown,
) => Promise<McpToolResult>;

/**
 * Provider-neutral description of one MCP tool. The same definition feeds the
 * in-process Claude binding and the streamable HTTP binding Codex consumes, so
 * the handlers and zod schemas are written once.
 */
export interface McpToolDefinition<Schema extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  schema: Schema;
  handler: McpToolHandler<Schema>;
}

export type AnyMcpToolDefinition = McpToolDefinition<any>;

export function defineTool<Schema extends ZodRawShape>(
  name: string,
  description: string,
  schema: Schema,
  handler: McpToolHandler<Schema>,
): McpToolDefinition<Schema> {
  return { name, description, schema, handler };
}
