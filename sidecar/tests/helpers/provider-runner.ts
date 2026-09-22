import type { AgentProvider } from "../../src/agent/provider.js";
import { type AgentRunner, createAgentRunner } from "../../src/agent/runner.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { createMcpHttpRegistry } from "../../src/mcp/http-binding.js";
import type { AiMcpServerDeps } from "../../src/mcp/types.js";
import { createClaudeProvider } from "../../src/providers/claude/provider.js";
import { createCodexProvider } from "../../src/providers/codex/provider.js";
import type { AppSettings } from "../../src/state/settings-types.js";
import type { ProviderName } from "../../src/state/types.js";

const UNREACHABLE_MCP_URL = "http://127.0.0.1:1/mcp";
const MOCK_API_KEY = "sk-mock";

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
    // No tool in these turns reaches MCP, so the binding is registered but
    // never dialled; the URL is deliberately dead.
    const registry = createMcpHttpRegistry();
    return {
      provider: createCodexProvider({
        timeoutMs: options.timeoutMs,
        settings: options.settings,
        stateDir: options.stateDir,
        mcpHttpRegistry: registry,
        createMcpDeps: () => ({}) as unknown as AiMcpServerDeps,
        getMcpUrl: () => UNREACHABLE_MCP_URL,
        getApiKey: () => MOCK_API_KEY,
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
      runner.dispose();
      await built.dispose();
    },
  };
}
