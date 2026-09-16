import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  LIST_PAGES_EMPTY_MESSAGE,
  LIST_PAGES_ERROR_MESSAGE,
  LIST_PAGES_TOOL_DESCRIPTION,
  LIST_PAGES_TOOL_NAME,
} from "../../constants/pages.js";
import type { RegistryClient } from "../../pages/registry-client.js";

export interface ListPagesDeps {
  registry: RegistryClient;
}

const INPUT_SCHEMA = { refresh: z.boolean().optional() } as const;

function buildContent(text: string): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text }] };
}

export function buildListPagesTool(deps: ListPagesDeps) {
  return tool(
    LIST_PAGES_TOOL_NAME,
    LIST_PAGES_TOOL_DESCRIPTION,
    INPUT_SCHEMA,
    async ({ refresh }: { refresh?: boolean }) => {
      // A page just created/edited only shows up once the backend has
      // re-registered it; refresh drops the 30s sidecar cache so the agent can
      // see it without waiting.
      if (refresh === true) deps.registry.invalidate();
      let entries: Awaited<ReturnType<RegistryClient["getRegistry"]>>;
      try {
        entries = await deps.registry.getRegistry();
      } catch {
        return buildContent(LIST_PAGES_ERROR_MESSAGE);
      }
      if (entries.length === 0) return buildContent(LIST_PAGES_EMPTY_MESSAGE);
      const pages = entries.map((e) => ({
        id: e.id,
        path: e.path,
        moduleId: e.moduleId,
      }));
      return buildContent(JSON.stringify(pages));
    },
  );
}
