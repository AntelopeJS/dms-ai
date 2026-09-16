import { BUILDER_TOOL_NAMES } from "./builder.js";
import { QUERY_LOGS_TOOL_NAME } from "./logs.js";
import { FIND_PAGES_TOOL_NAME, LIST_PAGES_TOOL_NAME } from "./pages.js";
import { TYPECHECK_TOOL_NAME } from "./typecheck.js";

export const MCP_SERVER_NAME = "dms-ai-mcp";
export const MCP_SERVER_VERSION = "0.0.1";
export const MCP_SERVER_KEY = "dms-ai";
export const MCP_SERVER_TYPE_SDK = "sdk" as const;

// The SDK exposes MCP tools to the model as mcp__<serverKey>__<toolName>.
export const MCP_TOOL_NAME_PREFIX = `mcp__${MCP_SERVER_KEY}__`;

export const GET_CURRENT_PAGE_TOOL_NAME = "GetCurrentPage";
export const GET_CURRENT_PAGE_TOOL_DESCRIPTION =
  "Returns the path/filepath of the page currently displayed in the host browser.";

export const NAVIGATE_TOOL_NAME = "NavigateToPage";
export const NAVIGATE_TOOL_DESCRIPTION =
  "Navigates the host browser to the given path using the host router. Awaits a host navigation-complete confirmation (with a short timeout fallback). Call GetCurrentPage to verify if needed.";
export const NAVIGATE_RESULT_PREFIX = "Navigation requested to ";
export const NAVIGATE_RESULT_COMPLETED_SUFFIX = " (completed)";
export const NAVIGATE_RESULT_TIMEOUT_SUFFIX =
  " (timed out waiting for confirmation)";
// Appended to the navigate result so the agent gets grounded confirmation of the
// page the host is actually on now, rather than assuming the requested path took.
export const NAVIGATE_RESULT_LANDED_PREFIX = ". Host is now displaying ";

// Returned instead of navigating when the requested path matches no registered
// route — stops the agent from landing on a guessed URL that 404s.
export const NAVIGATE_UNKNOWN_ROUTE_PREFIX = "Did not navigate: ";
export const NAVIGATE_UNKNOWN_ROUTE_SUFFIX =
  " is not a registered page route. Closest known routes: ";
export const NAVIGATE_UNKNOWN_ROUTE_HINT =
  ". Call ListPages for the full list and use a real route.";
// Cap the number of suggested routes inlined into the tool result.
export const NAVIGATE_SUGGESTION_LIMIT = 20;

export const ASK_USER_TOOL_NAME = "AskUser";
export const ASK_USER_TOOL_DESCRIPTION =
  "Ask the user one or more multiple-choice questions and wait for their answer. Use this whenever you need a decision or clarification instead of asking in prose. Provide 1-4 questions, each with 2-4 distinct options ({label, description}); the user may also type a custom answer. Returns the user's chosen answer for each question.";
export const ASK_USER_RESULT_PREFIX = "User answered:";
export const ASK_USER_RESULT_NO_ANSWER =
  "The user did not answer (the question timed out or was dismissed).";

// The SDK's built-in AskUserQuestion tool cannot render in the chatbox host, so
// calls to it dead-end at the permission prompt. Redirect the agent to the
// module's own AskUser MCP tool, which routes to the question bus the chatbox
// does render.
export const ASK_USER_QUESTION_BUILTIN_TOOL_NAME = "AskUserQuestion";
export const ASK_USER_QUESTION_REDIRECT_MESSAGE = `AskUserQuestion is not available here. Use the ${MCP_TOOL_NAME_PREFIX}${ASK_USER_TOOL_NAME} tool instead to ask the user multiple-choice questions.`;

// Explicit allowlist of the module's own MCP tools that are safe to auto-allow
// without a permission prompt: none of them mutate host state (page reads and
// navigation, listing pages, asking the user, running tsc for a typecheck,
// querying logs). Keyed by the fully qualified name the SDK presents to the
// model. Any new dms-ai tool is NOT auto-allowed until it is added here
// deliberately.
export const FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES: ReadonlySet<string> = new Set(
  [
    GET_CURRENT_PAGE_TOOL_NAME,
    NAVIGATE_TOOL_NAME,
    FIND_PAGES_TOOL_NAME,
    LIST_PAGES_TOOL_NAME,
    ASK_USER_TOOL_NAME,
    TYPECHECK_TOOL_NAME,
    QUERY_LOGS_TOOL_NAME,
    ...BUILDER_TOOL_NAMES,
  ].map((name) => `${MCP_TOOL_NAME_PREFIX}${name}`),
);
