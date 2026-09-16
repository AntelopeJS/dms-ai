import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type {
  QuestionAnswers,
  QuestionRequest,
} from "../agent/question-bus.js";
import type { BuilderClient } from "../builder/builder-client.js";
import type { LogsClient } from "../logs/logs-client.js";
import type { ImportsScanner } from "../pages/imports-scanner.js";
import type { RegistryClient } from "../pages/registry-client.js";
import type { AnyServerEventType } from "../protocol/events.js";
import type { NavigationCompleter } from "../server/navigation-completer.js";
import type { CurrentPage } from "../state/host-state.js";

// Deps shared by every conversation's MCP server. Assembled once at startup.
export interface AiMcpServerStaticDeps {
  getCurrentPage: () => CurrentPage;
  registry: RegistryClient;
  scanner: ImportsScanner;
  hostProjectRoot: string;
  moduleRoots: string[];
  logsClient: LogsClient;
  builderClient: BuilderClient;
  builderEnabled: boolean;
  sendToHost: (event: AnyServerEventType) => void;
  navigationCompleter: NavigationCompleter;
}

// The MCP server is built per conversation so conversation-scoped tools (AskUser)
// can route to the right iframe — the SDK does not pass our conversationId to tool
// handlers, so we bind it here at construction instead.
export interface AiMcpServerDeps extends AiMcpServerStaticDeps {
  conversationId: string;
  requestQuestion: (req: QuestionRequest) => Promise<QuestionAnswers>;
  getLastEditedFile: () => string | undefined;
}

export type AiMcpServer = McpSdkServerConfigWithInstance;
