import { z } from "zod";
import {
  BUILDER_ESCALATION_NOTE,
  BUILDER_EXPR_REFUSAL,
} from "../../prompts/builder.js";
import type { McpToolResult } from "../define-tool.js";
import { opResult } from "./builder-project.js";

/** Runs one Builder operation and answers its result as a tool result. */
export type BuilderRun = (
  op: string,
  args: unknown[],
) => Promise<McpToolResult>;

/** A tool description with the escalation note every Builder tool carries. */
export function note(description: string): string {
  return `${description}\n\n${BUILDER_ESCALATION_NOTE}`;
}

const EXPR_SENTINEL = z.object({ $expr: z.string() });
const EXPR_CARRIER = z.record(z.string(), z.unknown());

/** Whether a value carries a `$expr` sentinel anywhere inside it. */
export function hasExprSentinel(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasExprSentinel);
  }
  if (EXPR_SENTINEL.safeParse(value).success) {
    return true;
  }
  const record = EXPR_CARRIER.safeParse(value);
  return record.success && Object.values(record.data).some(hasExprSentinel);
}

/** The refusal a tool answers when its arguments carry a `$expr` sentinel. */
export function exprRefusal(): McpToolResult {
  return opResult({
    ok: false,
    error: { code: "unsupported", detail: BUILDER_EXPR_REFUSAL },
  });
}
