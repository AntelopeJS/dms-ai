import {
  GET_CURRENT_PAGE_TOOL_DESCRIPTION,
  GET_CURRENT_PAGE_TOOL_NAME,
} from "../../constants/mcp.js";
import type { CurrentPage } from "../../state/host-state.js";
import { defineTool, type McpToolResult } from "../define-tool.js";

type get_current_page = () => CurrentPage;

const EMPTY_INPUT_SCHEMA = {} as const;

function buildContent(page: CurrentPage): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(page) }],
  };
}

export function buildGetCurrentPageTool(getCurrentPage: get_current_page) {
  return defineTool(
    GET_CURRENT_PAGE_TOOL_NAME,
    GET_CURRENT_PAGE_TOOL_DESCRIPTION,
    EMPTY_INPUT_SCHEMA,
    async () => buildContent(getCurrentPage()),
  );
}
