import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  QUERY_LOGS_EMPTY_MESSAGE,
  QUERY_LOGS_ERROR_MESSAGE,
  QUERY_LOGS_TOOL_DESCRIPTION,
  QUERY_LOGS_TOOL_NAME,
} from "../../constants/logs.js";
import type { LogsClient } from "../../logs/logs-client.js";

export interface QueryLogsDeps {
  logsClient: LogsClient;
}

const INPUT_SCHEMA = {
  sinceMs: z.number().optional(),
  level: z.number().optional(),
  channel: z.string().optional(),
  limit: z.number().optional(),
} as const;

interface QueryLogsInput {
  sinceMs?: number;
  level?: number;
  channel?: string;
  limit?: number;
}

function buildContent(text: string): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text }] };
}

export function buildQueryLogsTool(deps: QueryLogsDeps) {
  return tool(
    QUERY_LOGS_TOOL_NAME,
    QUERY_LOGS_TOOL_DESCRIPTION,
    INPUT_SCHEMA,
    async ({ sinceMs, level, channel, limit }: QueryLogsInput) => {
      let entries: Awaited<ReturnType<LogsClient["getLogs"]>>;
      try {
        entries = await deps.logsClient.getLogs({
          since: sinceMs,
          level,
          channel,
          limit,
        });
      } catch {
        return buildContent(QUERY_LOGS_ERROR_MESSAGE);
      }
      if (entries.length === 0) return buildContent(QUERY_LOGS_EMPTY_MESSAGE);
      return buildContent(JSON.stringify(entries));
    },
  );
}
