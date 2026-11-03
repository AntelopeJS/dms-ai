import { z } from "zod";
import type { OperationName } from "@antelopejs/interface-dms-builder";
import type { BuilderOpArgs } from "../../builder/builder-client.js";
import {
  BUILDER_ESCALATION_NOTE,
  BUILDER_EXPR_REFUSAL,
} from "../../prompts/builder.js";
import type { McpToolResult } from "../define-tool.js";
import { opResult } from "./builder-project.js";

/** Runs one Builder operation and answers its result as a tool result. */
export type BuilderRun = <N extends OperationName>(
  op: N,
  args: BuilderOpArgs<N>,
) => Promise<McpToolResult>;

/** A tool description with the escalation note every Builder tool carries. */
export function note(description: string): string {
  return `${description}\n\n${BUILDER_ESCALATION_NOTE}`;
}

const EXPR_SENTINEL = z.object({ $expr: z.string() });

/** Whether an agent-supplied value holds a `{ $expr }` sentinel at any depth of arrays and records. */
export const containsExprSentinel: z.ZodType<boolean> = z.lazy(() =>
  z.union([
    EXPR_SENTINEL.transform(() => true),
    z.array(containsExprSentinel).transform((items) => items.some(Boolean)),
    z
      .record(z.string(), containsExprSentinel)
      .transform((members) => Object.values(members).some(Boolean)),
    z.unknown().transform(() => false),
  ]),
);

/** The refusal a tool answers when its arguments carry a `$expr` sentinel. */
export function exprRefusal(): McpToolResult {
  return opResult({
    ok: false,
    error: { code: "unsupported", detail: BUILDER_EXPR_REFUSAL },
  });
}
