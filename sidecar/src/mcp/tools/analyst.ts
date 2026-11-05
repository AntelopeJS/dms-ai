import { z } from "zod";
import type { AnalystClient } from "../../analyst/analyst-client.js";
import { createAnalystDatasets } from "../../analyst/datasets.js";
import {
  ANALYST_DESCRIBE_PAGE_DESCRIPTION,
  ANALYST_DESCRIBE_PAGE_TOOL_NAME,
  ANALYST_LIST_PAGES_DESCRIPTION,
  ANALYST_LIST_PAGES_TOOL_NAME,
  ANALYST_PAGES_PATH,
  ANALYST_READ_ROWS_DESCRIPTION,
  ANALYST_READ_ROWS_TOOL_NAME,
  ANALYST_ROW_CAP,
  ANALYST_TABLES_PATH,
} from "../../constants/analyst.js";
import type { JsonValue } from "../../protocol/json.js";
import {
  type AnyMcpToolDefinition,
  defineTool,
  type McpToolResult,
} from "../define-tool.js";
import {
  buildAnalystDatasetTools,
  type WithGrant,
} from "./analyst-datasets.js";
import { PAGE, readRows, ROWS_SELECTION } from "./analyst-rows.js";

export interface AnalystToolsDeps {
  analystClient: AnalystClient;
  /** The grant of whoever asked for the running turn; none, nothing is read. */
  currentGrant: () => string | undefined;
}

const FAILED_ANSWER = z.object({ ok: z.literal(false) });
const NO_GRANT_ANSWER = {
  ok: false,
  error: {
    code: "no_user",
    detail: "No signed-in user is attached to this turn.",
  },
};

function answer(value: JsonValue): McpToolResult {
  const text = JSON.stringify(value);
  return FAILED_ANSWER.safeParse(value).success
    ? { content: [{ type: "text", text }], isError: true }
    : { content: [{ type: "text", text }] };
}

/**
 * Analyst's whole reach: the pages, tables and rows the user may see, and the
 * sandbox computing over the rows it loaded. The datasets live as long as the
 * returned tools: one set of tools per conversation keeps conversations apart.
 */
export function buildAnalystTools(
  deps: AnalystToolsDeps,
): AnyMcpToolDefinition[] {
  const { analystClient: client } = deps;
  const withGrant: WithGrant = async (read) => {
    const grant = deps.currentGrant();
    return answer(grant === undefined ? NO_GRANT_ANSWER : await read(grant));
  };
  return [
    defineTool(
      ANALYST_LIST_PAGES_TOOL_NAME,
      ANALYST_LIST_PAGES_DESCRIPTION,
      {},
      () =>
        withGrant((grant) =>
          client.get(ANALYST_PAGES_PATH, new URLSearchParams(), grant),
        ),
    ),
    defineTool(
      ANALYST_DESCRIBE_PAGE_TOOL_NAME,
      ANALYST_DESCRIBE_PAGE_DESCRIPTION,
      { page: PAGE },
      ({ page }) =>
        withGrant((grant) =>
          client.get(ANALYST_TABLES_PATH, new URLSearchParams({ page }), grant),
        ),
    ),
    defineTool(
      ANALYST_READ_ROWS_TOOL_NAME,
      ANALYST_READ_ROWS_DESCRIPTION,
      {
        ...ROWS_SELECTION,
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(ANALYST_ROW_CAP).optional(),
      },
      (args) => withGrant((grant) => readRows(client, grant, args)),
    ),
    ...buildAnalystDatasetTools(client, createAnalystDatasets(), withGrant),
  ];
}
