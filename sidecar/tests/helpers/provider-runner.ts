import type { AgentProvider } from "../../src/agent/provider.js";
import { type AgentRunner, createAgentRunner } from "../../src/agent/runner.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { createMcpHttpRegistry } from "../../src/mcp/http-binding.js";
import type {
  AiMcpServerDeps,
  AiMcpServerStaticDeps,
} from "../../src/mcp/types.js";
import { createClaudeProvider } from "../../src/providers/claude/provider.js";
import { createCodexProvider } from "../../src/providers/codex/provider.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import type { AppSettings } from "../../src/state/settings-types.js";
import type { ProviderName } from "../../src/state/types.js";

/**
 * No tool in these turns reaches MCP, so the binding is registered but never
 * dialled; the URL is deliberately dead.
 */
const UNREACHABLE_MCP_URL = "http://127.0.0.1:1/mcp";
const UNREACHABLE_HOST_ROOT = "/tmp";

/** The MCP dependencies of a host that is not there: every client answers empty. */
export function buildInertStaticMcpDeps(
  getCurrentPage: AiMcpServerStaticDeps["getCurrentPage"],
  navigationCompleter: AiMcpServerStaticDeps["navigationCompleter"],
  hostProjectRoot: string,
): AiMcpServerStaticDeps {
  return {
    getCurrentPage,
    registry: {
      getRegistry: async () => [],
      getStaleSinceMs: () => null,
      invalidate: () => {},
    },
    scanner: {
      scan: async () => ({ importersByFile: new Map() }),
      invalidate: () => {},
    },
    hostProjectRoot,
    moduleRoots: [],
    logsClient: { getLogs: async () => [] },
    builderClient: { call: async () => null },
    databaseClient: { get: async () => [], post: async () => ({}) },
    builderEnabled: false,
    navigationCompleter,
  };
}

/** Per-conversation MCP dependencies for a provider whose tools are never called. */
export function buildInertMcpDeps(conversationId: string): AiMcpServerDeps {
  return {
    ...buildInertStaticMcpDeps(
      () => ({ path: UNKNOWN_PAGE_PATH }),
      createNavigationCompleter(),
      UNREACHABLE_HOST_ROOT,
    ),
    conversationId,
    sendToHost: () => {},
    requestQuestion: () =>
      Promise.reject(new Error("no question is expected in this test")),
    getLastEditedFile: () => undefined,
    showPreview: () => {},
    listAttachedImages: () => [],
  };
}

export interface RunnerHandle {
  runner: AgentRunner;
  dispose: () => Promise<void>;
}

export interface RunnerOptions {
  timeoutMs?: number;
  settings?: AppSettings;
  stateDir: string;
}

function buildClaude(options: RunnerOptions): AgentProvider {
  return createClaudeProvider({
    timeoutMs: options.timeoutMs,
    settings: options.settings,
  });
}

type ProviderBuilder = (options: RunnerOptions) => {
  provider: AgentProvider;
  dispose: () => Promise<void>;
};

const BUILDERS: Record<ProviderName, ProviderBuilder> = {
  claude: (options) => ({
    provider: buildClaude(options),
    dispose: () => Promise.resolve(),
  }),
  codex: (options) => {
    const registry = createMcpHttpRegistry();
    return {
      provider: createCodexProvider({
        timeoutMs: options.timeoutMs,
        settings: options.settings,
        stateDir: options.stateDir,
        mcpHttpRegistry: registry,
        createMcpDeps: buildInertMcpDeps,
        getMcpUrl: () => UNREACHABLE_MCP_URL,
      }),
      dispose: () => registry.dispose(),
    };
  },
};

/** One runner on the named provider, with its mock already selected by the caller. */
export function buildRunner(
  name: ProviderName,
  options: RunnerOptions,
): RunnerHandle {
  const built = BUILDERS[name](options);
  const runner = createAgentRunner(built.provider, {
    settings: options.settings ?? DEFAULT_SETTINGS,
  });
  return {
    runner,
    dispose: async () => {
      await runner.dispose();
      await built.dispose();
    },
  };
}
