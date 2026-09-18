import {
  GET_CURRENT_PAGE_TOOL_DESCRIPTION,
  GET_CURRENT_PAGE_TOOL_NAME,
} from "../../constants/mcp.js";
import type { CurrentPage } from "../../state/host-state.js";
import { defineTool } from "../define-tool.js";

type GetCurrentPage = () => CurrentPage;

const EMPTY_INPUT_SCHEMA = {} as const;

function buildContent(page: CurrentPage): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(page) }],
  };
}

export function buildGetCurrentPageTool(getCurrentPage: GetCurrentPage) {
  return defineTool(
    GET_CURRENT_PAGE_TOOL_NAME,
    GET_CURRENT_PAGE_TOOL_DESCRIPTION,
    EMPTY_INPUT_SCHEMA,
    async () => buildContent(getCurrentPage()),
  );
}
