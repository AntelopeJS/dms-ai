import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { resolveTypecheckTarget, runTypecheck } from "../../agent/typecheck.js";
import {
  TYPECHECK_TOOL_DESCRIPTION,
  TYPECHECK_TOOL_NAME,
  TYPECHECK_UNKNOWN_TARGET_PREFIX,
  TYPECHECK_UNKNOWN_TARGET_SUFFIX,
} from "../../constants/typecheck.js";

export interface TypecheckToolDeps {
  hostProjectRoot: string;
  moduleRoots: string[];
  getLastEditedFile: () => string | undefined;
}

const INPUT_SCHEMA = { target: z.string().optional() } as const;

function buildContent(text: string): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text }] };
}

export function buildTypecheckTool(deps: TypecheckToolDeps) {
  return tool(
    TYPECHECK_TOOL_NAME,
    TYPECHECK_TOOL_DESCRIPTION,
    INPUT_SCHEMA,
    async ({ target }: { target?: string }) => {
      const knownRoots = [deps.hostProjectRoot, ...deps.moduleRoots];
      const { root, knownTargets } = resolveTypecheckTarget(
        target,
        knownRoots,
        deps.getLastEditedFile(),
        deps.hostProjectRoot,
      );
      if (root === null) {
        return buildContent(
          `${TYPECHECK_UNKNOWN_TARGET_PREFIX}${target}${TYPECHECK_UNKNOWN_TARGET_SUFFIX}${knownTargets.join(", ")}`,
        );
      }
      const result = await runTypecheck({ targetRoot: root });
      return buildContent(result.summary);
    },
  );
}
